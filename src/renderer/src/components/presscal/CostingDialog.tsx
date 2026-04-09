import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, Calculator, Search, User, FileText, Loader2, ExternalLink, FolderOpen } from 'lucide-react'
import { useAppStore } from '@/stores/app-store'
import type { PresscalCustomer, PresscalQuote } from '@/lib/ipc'

interface CostingDialogProps {
  filePath: string
  fileName: string
  onClose: () => void
}

type Target = 'customer' | 'quote'

async function doUpload(filePath: string, fileName: string, target: Target, targetId: string, saveToFolder: boolean, quoteId?: string) {
  const result = await window.api.presscal.uploadFileForCosting({
    filePath,
    fileName,
    target,
    targetId,
    quoteId
  })

  // Copy to customer folder if requested
  if (saveToFolder && result.customerFolderPath) {
    try {
      await window.api.presscal.saveToCustomerFolder(filePath, result.customerFolderPath, fileName)
    } catch (e) {
      console.error('Failed to copy to customer folder:', e)
    }
  }

  if (result.calculatorUrl) {
    let url = result.calculatorUrl
    if (url.startsWith('/')) {
      const presscalUrl = await window.api.settings.get('presscal.url') as string
      if (presscalUrl) {
        url = presscalUrl.replace(/\/$/, '') + url
      }
    }
    await window.api.shell.openExternal(url)
  }
  return result
}

export function CostingDialog({ filePath, fileName, onClose }: CostingDialogProps) {
  const attachmentQuoteId = useAppStore(s => s.attachmentQuoteId)
  const pickFileMode = useAppStore(s => s.pickFileMode)
  const knownQuoteId = attachmentQuoteId || pickFileMode?.quoteId || ''

  if (knownQuoteId) {
    return <CostingConfirm filePath={filePath} fileName={fileName} quoteId={knownQuoteId} onClose={onClose} />
  }

  return <CostingPicker filePath={filePath} fileName={fileName} onClose={onClose} />
}

// ─── Quick confirm when quote is known ───
function CostingConfirm({ filePath, fileName, quoteId, onClose }: CostingDialogProps & { quoteId: string }) {
  const [quote, setQuote] = useState<PresscalQuote | null>(null)
  const [customerFolder, setCustomerFolder] = useState<string | null>(null)
  const [saveToFolder, setSaveToFolder] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Fetch quote info + check if customer has folder
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const q = await window.api.presscal.getQuote(quoteId)
        if (cancelled) return
        setQuote(q)
        // Check customer folder
        if (q?.customerId) {
          const customers = await window.api.presscal.getCustomers()
          const customer = customers.find((c: any) => c.id === q.customerId)
          if (customer?.folderPath && !cancelled) {
            setCustomerFolder(customer.folderPath)
          }
        }
      } catch {} finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [quoteId])

  const handleUpload = async () => {
    setUploading(true)
    setError(null)
    try {
      await doUpload(filePath, fileName, 'quote', quoteId, saveToFolder && !!customerFolder)
      onClose()
    } catch (e: any) {
      setError(e.message || 'Αποτυχία upload')
      setUploading(false)
    }
  }

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', padding: 40 }}>
      <div style={{ width: '100%', maxWidth: 480, background: 'var(--th-bg-secondary)', borderRadius: 16, border: '1px solid var(--th-border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div className="flex items-center justify-between" style={{ padding: '20px 24px', borderBottom: '1px solid var(--th-border)' }}>
          <div className="flex items-center gap-3">
            <Calculator size={20} style={{ color: '#f58220' }} />
            <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--th-text-primary)' }}>Κοστολόγηση</span>
          </div>
          <button onClick={onClose} style={{ padding: 6, background: 'none', border: 'none', cursor: 'pointer', borderRadius: 8, color: 'var(--th-text-muted)' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* File */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={14} style={{ color: 'var(--th-text-muted)' }} />
            <span className="truncate" style={{ fontSize: 13, color: 'var(--th-text-secondary)' }}>{fileName}</span>
          </div>

          {/* Quote info */}
          {loading ? (
            <div className="flex items-center gap-2" style={{ color: 'var(--th-text-muted)' }}>
              <Loader2 size={14} className="animate-spin" />
              <span style={{ fontSize: 13 }}>Φόρτωση...</span>
            </div>
          ) : quote && (
            <div style={{ padding: '12px 14px', borderRadius: 8, background: 'rgba(245,130,32,0.06)', border: '1px solid rgba(245,130,32,0.15)' }}>
              <div style={{ fontSize: 13, color: '#f58220', fontWeight: 600 }}>Προσφορά #{quote.number}</div>
              {quote.customerName && quote.customerName !== '–' && <div style={{ fontSize: 12, color: 'var(--th-text-secondary)', marginTop: 2 }}>{quote.customerName}</div>}
            </div>
          )}

          {/* Customer folder checkbox */}
          {customerFolder && (
            <label
              className="flex items-center cursor-pointer"
              style={{ gap: 10, padding: '12px 14px', borderRadius: 8, background: 'var(--th-bg-tertiary)', border: '1px solid var(--th-border)' }}
              onClick={() => setSaveToFolder(!saveToFolder)}
            >
              <input type="checkbox" checked={saveToFolder} readOnly style={{ width: 16, height: 16, accentColor: '#f58220' }} />
              <FolderOpen size={14} style={{ color: saveToFolder ? '#f58220' : 'var(--th-text-muted)', flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--th-text-primary)' }}>Αποθήκευση στον φάκελο πελάτη</div>
                <div className="truncate" style={{ fontSize: 11, color: 'var(--th-text-muted)', marginTop: 2 }}>{customerFolder}</div>
              </div>
            </label>
          )}

          {error && <div style={{ fontSize: 13, color: '#ef4444' }}>{error}</div>}
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid var(--th-border)' }}>
          <button
            onClick={onClose}
            style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid var(--th-border)', background: 'transparent', color: 'var(--th-text-secondary)', fontSize: 13, cursor: 'pointer' }}
          >
            Ακύρωση
          </button>
          <button
            onClick={handleUpload}
            disabled={uploading || loading}
            style={{
              padding: '10px 24px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: '#f58220', color: '#fff', fontSize: 13, fontWeight: 600,
              opacity: (uploading || loading) ? 0.5 : 1,
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
            {uploading ? 'Αποστολή...' : 'Κοστολόγηση'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── Manual picker when no quote context ───
function CostingPicker({ filePath, fileName, onClose }: CostingDialogProps) {
  const [target, setTarget] = useState<Target>('customer')
  const [search, setSearch] = useState('')
  const [customers, setCustomers] = useState<PresscalCustomer[]>([])
  const [quotes, setQuotes] = useState<PresscalQuote[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchItems = useCallback(async (q: string) => {
    setLoading(true)
    setError(null)
    try {
      if (target === 'customer') {
        const results = await window.api.presscal.getCustomers(q || undefined)
        setCustomers(results)
      } else {
        const results = await window.api.presscal.getQuotes({ search: q || undefined })
        setQuotes(results)
      }
    } catch {
      setError('Αποτυχία φόρτωσης')
    } finally {
      setLoading(false)
    }
  }, [target])

  useEffect(() => {
    setSelectedId(null)
    setSearch('')
    fetchItems('')
  }, [target, fetchItems])

  useEffect(() => {
    const timer = setTimeout(() => fetchItems(search), 300)
    return () => clearTimeout(timer)
  }, [search, fetchItems])

  const handleUpload = async () => {
    if (!selectedId) return
    setUploading(true)
    setError(null)
    try {
      await doUpload(filePath, fileName, target, selectedId, false)
      onClose()
    } catch (e: any) {
      setError(e.message || 'Αποτυχία upload')
      setUploading(false)
    }
  }

  const selectedLabel = target === 'customer'
    ? customers.find(c => c.id === selectedId)?.name
    : quotes.find(q => q.id === selectedId)?.number

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', padding: 40 }}
    >
      <div style={{ width: '100%', maxWidth: 560, maxHeight: '80vh', background: 'var(--th-bg-secondary)', borderRadius: 16, border: '1px solid var(--th-border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div className="flex items-center justify-between" style={{ padding: '20px 24px', borderBottom: '1px solid var(--th-border)' }}>
          <div className="flex items-center gap-3">
            <Calculator size={20} style={{ color: '#f58220' }} />
            <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--th-text-primary)' }}>Αποθήκευση & Κοστολόγηση</span>
          </div>
          <button onClick={onClose} style={{ padding: 6, background: 'none', border: 'none', cursor: 'pointer', borderRadius: 8, color: 'var(--th-text-muted)' }}>
            <X size={18} />
          </button>
        </div>

        {/* File info */}
        <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--th-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText size={14} style={{ color: 'var(--th-text-muted)' }} />
          <span className="truncate" style={{ fontSize: 13, color: 'var(--th-text-secondary)' }}>{fileName}</span>
        </div>

        {/* Target toggle */}
        <div style={{ padding: '16px 24px 12px', display: 'flex', gap: 8 }}>
          <button
            onClick={() => setTarget('customer')}
            style={{
              flex: 1, padding: '10px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              background: target === 'customer' ? 'rgba(245,130,32,0.12)' : 'var(--th-bg-tertiary)',
              color: target === 'customer' ? '#f58220' : 'var(--th-text-secondary)',
            }}
          >
            <User size={15} />
            Πελάτης
          </button>
          <button
            onClick={() => setTarget('quote')}
            style={{
              flex: 1, padding: '10px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              background: target === 'quote' ? 'rgba(245,130,32,0.12)' : 'var(--th-bg-tertiary)',
              color: target === 'quote' ? '#f58220' : 'var(--th-text-secondary)',
            }}
          >
            <FileText size={15} />
            Προσφορά
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: '0 24px 12px' }}>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--th-text-muted)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={target === 'customer' ? 'Αναζήτηση πελάτη...' : 'Αναζήτηση προσφοράς...'}
              autoFocus
              style={{
                width: '100%', padding: '10px 12px 10px 36px', borderRadius: 8,
                background: 'var(--th-bg-primary)', border: '1px solid var(--th-border)', color: 'var(--th-text-primary)',
                fontSize: 13, outline: 'none',
              }}
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto" style={{ padding: '0 24px', minHeight: 200, maxHeight: 320 }}>
          {loading && (
            <div className="flex items-center justify-center" style={{ padding: 32, color: 'var(--th-text-muted)' }}>
              <Loader2 size={20} className="animate-spin" />
            </div>
          )}
          {!loading && error && (
            <div style={{ padding: 20, textAlign: 'center', color: '#ef4444', fontSize: 13 }}>{error}</div>
          )}
          {!loading && !error && target === 'customer' && customers.map(c => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              style={{
                width: '100%', textAlign: 'left', padding: '10px 14px', borderRadius: 8, marginBottom: 4,
                border: selectedId === c.id ? '1px solid #f58220' : '1px solid transparent',
                background: selectedId === c.id ? 'rgba(245,130,32,0.08)' : 'var(--th-bg-tertiary)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
              }}
            >
              <User size={14} style={{ color: selectedId === c.id ? '#f58220' : 'var(--th-text-muted)', flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <div className="truncate" style={{ fontSize: 13, color: selectedId === c.id ? '#f58220' : 'var(--th-text-primary)', fontWeight: 500 }}>
                  {c.name}
                </div>
                {c.company && (
                  <div className="truncate" style={{ fontSize: 12, color: 'var(--th-text-muted)' }}>{c.company}</div>
                )}
              </div>
            </button>
          ))}
          {!loading && !error && target === 'quote' && quotes.map(q => (
            <button
              key={q.id}
              onClick={() => setSelectedId(q.id)}
              style={{
                width: '100%', textAlign: 'left', padding: '10px 14px', borderRadius: 8, marginBottom: 4,
                border: selectedId === q.id ? '1px solid #f58220' : '1px solid transparent',
                background: selectedId === q.id ? 'rgba(245,130,32,0.08)' : 'var(--th-bg-tertiary)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
              }}
            >
              <FileText size={14} style={{ color: selectedId === q.id ? '#f58220' : 'var(--th-text-muted)', flexShrink: 0 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 13, color: selectedId === q.id ? '#f58220' : 'var(--th-text-primary)', fontWeight: 600 }}>
                    #{q.number}
                  </span>
                  <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: 'var(--th-bg-hover)', color: 'var(--th-text-secondary)' }}>
                    {q.status}
                  </span>
                </div>
                {q.customerName && q.customerName !== '–' && (
                  <div className="truncate" style={{ fontSize: 12, color: 'var(--th-text-muted)' }}>{q.customerName}</div>
                )}
              </div>
            </button>
          ))}
          {!loading && !error && (
            (target === 'customer' && customers.length === 0) ||
            (target === 'quote' && quotes.length === 0)
          ) && (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--th-text-muted)', fontSize: 13 }}>
              Δεν βρέθηκαν αποτελέσματα
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--th-border)' }}>
          <div style={{ fontSize: 12, color: 'var(--th-text-muted)' }}>
            {selectedLabel && <>Επιλεγμένο: <span style={{ color: '#f58220' }}>{selectedLabel}</span></>}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onClose}
              style={{
                padding: '10px 20px', borderRadius: 8, border: '1px solid var(--th-border)',
                background: 'transparent', color: 'var(--th-text-secondary)', fontSize: 13, cursor: 'pointer',
              }}
            >
              Ακύρωση
            </button>
            <button
              onClick={handleUpload}
              disabled={!selectedId || uploading}
              style={{
                padding: '10px 24px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: '#f58220', color: '#fff', fontSize: 13, fontWeight: 600,
                opacity: (!selectedId || uploading) ? 0.5 : 1,
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
              {uploading ? 'Αποστολή...' : 'Κοστολόγηση'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
