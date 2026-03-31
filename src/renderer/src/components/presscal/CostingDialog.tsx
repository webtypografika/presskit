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
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', padding: 40 }}>
      <div style={{ width: '100%', maxWidth: 480, background: '#0f1525', borderRadius: 16, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border" style={{ padding: '20px 24px' }}>
          <div className="flex items-center gap-3">
            <Calculator size={20} style={{ color: '#f58220' }} />
            <span style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0' }}>Κοστολόγηση</span>
          </div>
          <button onClick={onClose} className="hover:bg-bg-hover rounded-lg" style={{ padding: 6 }}>
            <X size={18} className="text-text-muted" />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* File */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={14} style={{ color: '#64748b' }} />
            <span className="truncate" style={{ fontSize: 13, color: '#94a3b8' }}>{fileName}</span>
          </div>

          {/* Quote info */}
          {loading ? (
            <div className="flex items-center gap-2" style={{ color: '#64748b' }}>
              <Loader2 size={14} className="animate-spin" />
              <span style={{ fontSize: 13 }}>Φόρτωση...</span>
            </div>
          ) : quote && (
            <div style={{ padding: '12px 14px', borderRadius: 8, background: 'rgba(245,130,32,0.06)', border: '1px solid rgba(245,130,32,0.15)' }}>
              <div style={{ fontSize: 13, color: '#f58220', fontWeight: 600 }}>Προσφορά #{quote.number}</div>
              {quote.customerName && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{quote.customerName}</div>}
            </div>
          )}

          {/* Customer folder checkbox */}
          {customerFolder && (
            <label
              className="flex items-center cursor-pointer"
              style={{ gap: 10, padding: '12px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid #1e293b' }}
              onClick={() => setSaveToFolder(!saveToFolder)}
            >
              <input type="checkbox" checked={saveToFolder} readOnly style={{ width: 16, height: 16, accentColor: '#f58220' }} />
              <FolderOpen size={14} style={{ color: saveToFolder ? '#f58220' : '#475569', flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, color: '#e2e8f0' }}>Αποθήκευση στον φάκελο πελάτη</div>
                <div className="truncate" style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{customerFolder}</div>
              </div>
            </label>
          )}

          {error && <div style={{ fontSize: 13, color: '#ef4444' }}>{error}</div>}
        </div>

        {/* Footer */}
        <div className="border-t border-border" style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            onClick={onClose}
            style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #1e293b', background: 'transparent', color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}
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
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', padding: 40 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ width: '100%', maxWidth: 560, maxHeight: '80vh', background: '#0f1525', borderRadius: 16, border: '1px solid #1e293b', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border" style={{ padding: '20px 24px' }}>
          <div className="flex items-center gap-3">
            <Calculator size={20} style={{ color: '#f58220' }} />
            <span style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0' }}>Αποθήκευση & Κοστολόγηση</span>
          </div>
          <button onClick={onClose} className="hover:bg-bg-hover rounded-lg" style={{ padding: 6 }}>
            <X size={18} className="text-text-muted" />
          </button>
        </div>

        {/* File info */}
        <div style={{ padding: '12px 24px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText size={14} style={{ color: '#64748b' }} />
          <span className="truncate" style={{ fontSize: 13, color: '#94a3b8' }}>{fileName}</span>
        </div>

        {/* Target toggle */}
        <div style={{ padding: '16px 24px 12px', display: 'flex', gap: 8 }}>
          <button
            onClick={() => setTarget('customer')}
            style={{
              flex: 1, padding: '10px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              background: target === 'customer' ? 'rgba(245,130,32,0.12)' : 'rgba(255,255,255,0.03)',
              color: target === 'customer' ? '#f58220' : '#94a3b8',
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
              background: target === 'quote' ? 'rgba(245,130,32,0.12)' : 'rgba(255,255,255,0.03)',
              color: target === 'quote' ? '#f58220' : '#94a3b8',
            }}
          >
            <FileText size={15} />
            Προσφορά
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: '0 24px 12px' }}>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#475569' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={target === 'customer' ? 'Αναζήτηση πελάτη...' : 'Αναζήτηση προσφοράς...'}
              autoFocus
              style={{
                width: '100%', padding: '10px 12px 10px 36px', borderRadius: 8,
                background: '#0a0e1a', border: '1px solid #1e293b', color: '#e2e8f0',
                fontSize: 13, outline: 'none',
              }}
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto" style={{ padding: '0 24px', minHeight: 200, maxHeight: 320 }}>
          {loading && (
            <div className="flex items-center justify-center" style={{ padding: 32, color: '#64748b' }}>
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
                background: selectedId === c.id ? 'rgba(245,130,32,0.08)' : 'rgba(255,255,255,0.02)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
              }}
            >
              <User size={14} style={{ color: selectedId === c.id ? '#f58220' : '#475569', flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <div className="truncate" style={{ fontSize: 13, color: selectedId === c.id ? '#f58220' : '#e2e8f0', fontWeight: 500 }}>
                  {c.name}
                </div>
                {c.company && (
                  <div className="truncate" style={{ fontSize: 12, color: '#64748b' }}>{c.company}</div>
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
                background: selectedId === q.id ? 'rgba(245,130,32,0.08)' : 'rgba(255,255,255,0.02)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
              }}
            >
              <FileText size={14} style={{ color: selectedId === q.id ? '#f58220' : '#475569', flexShrink: 0 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 13, color: selectedId === q.id ? '#f58220' : '#e2e8f0', fontWeight: 600 }}>
                    #{q.number}
                  </span>
                  <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.06)', color: '#94a3b8' }}>
                    {q.status}
                  </span>
                </div>
                {q.customerName && (
                  <div className="truncate" style={{ fontSize: 12, color: '#64748b' }}>{q.customerName}</div>
                )}
              </div>
            </button>
          ))}
          {!loading && !error && (
            (target === 'customer' && customers.length === 0) ||
            (target === 'quote' && quotes.length === 0)
          ) && (
            <div style={{ padding: 32, textAlign: 'center', color: '#475569', fontSize: 13 }}>
              Δεν βρέθηκαν αποτελέσματα
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border" style={{ padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            {selectedLabel && <>Επιλεγμένο: <span style={{ color: '#f58220' }}>{selectedLabel}</span></>}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onClose}
              style={{
                padding: '10px 20px', borderRadius: 8, border: '1px solid #1e293b',
                background: 'transparent', color: '#94a3b8', fontSize: 13, cursor: 'pointer',
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
