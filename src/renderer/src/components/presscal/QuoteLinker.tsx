import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAppStore } from '@/stores/app-store'
import { fuzzyMatch } from '@/lib/fuzzy'
import {
  Search, Link2, FileText, Paperclip, Image, File,
  Loader2, CheckCircle, ChevronDown, ChevronRight, Download
} from 'lucide-react'
import type { PresscalQuote, FileLink } from '@/lib/ipc'
import { formatFileSize } from '@/lib/file-types'

interface EmailMessage {
  id: string
  threadId: string
  from: string
  subject: string
  date: string
  attachments: { id: string; filename: string; mimeType: string; size: number }[]
}

export function QuoteLinker() {
  const { selectedFile, preflight, selectFile } = useAppStore()
  const [allQuotes, setAllQuotes] = useState<PresscalQuote[]>([])
  const [fileLinks, setFileLinks] = useState<FileLink[]>([])
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [linkingTo, setLinkingTo] = useState<string | null>(null)
  const [expandedQuote, setExpandedQuote] = useState<string | null>(null)
  const [emailMessages, setEmailMessages] = useState<EmailMessage[]>([])
  const [loadingEmails, setLoadingEmails] = useState(false)
  const [downloadingAtt, setDownloadingAtt] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    window.api.presscal.getQuotes()
      .then(setAllQuotes)
      .catch(() => setAllQuotes([]))
      .finally(() => setLoading(false))
  }, [])

  // Exclude rejected & cancelled
  const activeQuotes = useMemo(() =>
    allQuotes.filter(q => q.status !== 'rejected' && q.status !== 'cancelled'),
    [allQuotes]
  )

  // Fixed status order matching PressCal flow
  const STATUS_ORDER = ['draft', 'sent', 'approved', 'completed']
  const STATUS_LABELS: Record<string, string> = {
    draft: 'In Progress',
    sent: 'Sent',
    approved: 'Approved',
    completed: 'Completed',
  }

  const statuses = useMemo(() => {
    const existing = new Set(activeQuotes.map(q => q.status))
    // Keep order, only show statuses that have quotes
    return STATUS_ORDER.filter(s => existing.has(s))
  }, [activeQuotes])

  const quotes = useMemo(() => {
    let result = activeQuotes
    if (filterStatus) {
      result = result.filter(q => q.status === filterStatus)
    }
    if (search.trim()) {
      result = result.filter(q => {
        const text = [q.number, q.customerName && q.customerName !== '–' ? q.customerName : null, q.title].filter(Boolean).join(' ')
        return fuzzyMatch(text, search)
      })
    }
    return result
  }, [activeQuotes, filterStatus, search])

  useEffect(() => {
    if (!selectedFile) return
    window.api.presscal.getFileLinks({})
      .then(data => setFileLinks(Array.isArray(data) ? data : []))
      .catch(() => setFileLinks([]))
  }, [selectedFile])

  const linkToQuote = useCallback(async (quoteId: string) => {
    if (!selectedFile || selectedFile.isDirectory) return
    setLinkingTo(quoteId)
    try {
      await window.api.presscal.linkFile({
        fileName: selectedFile.name,
        filePath: selectedFile.path,
        fileType: selectedFile.extension,
        fileSize: selectedFile.size,
        source: 'local',
        quoteId,
        preflightStatus: preflight?.overallStatus || undefined
      })
      const links = await window.api.presscal.getFileLinks({ quoteId })
      setFileLinks(Array.isArray(links) ? links : [])
    } catch {
    } finally {
      setLinkingTo(null)
    }
  }, [selectedFile, preflight])

  const isLinked = useCallback((quoteId: string) => {
    return fileLinks.some(link =>
      link.quoteId === quoteId && link.filePath === selectedFile?.path
    )
  }, [fileLinks, selectedFile])

  const navigateTo = useAppStore(s => s.navigateTo)

  const openQuoteFolder = useCallback(async (quote: PresscalQuote) => {
    // Try to get the full quote details to find the folder path
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
    // Fallback: open quote in PressCal browser
    try {
      const presscalUrl = await window.api.settings.get('presscal.url') as string
      if (presscalUrl) {
        window.api.shell.openExternal(`${presscalUrl.replace(/\/$/, '')}/quotes/${quote.id}`)
      }
    } catch {}
  }, [navigateTo])

  const toggleExpand = useCallback(async (quoteId: string) => {
    if (expandedQuote === quoteId) {
      setExpandedQuote(null)
      setEmailMessages([])
      return
    }

    setExpandedQuote(quoteId)
    setLoadingEmails(true)
    setEmailMessages([])

    try {
      const result = await window.api.presscal.getQuoteEmailMessages(quoteId)
      setEmailMessages(result.messages || [])
    } catch {
      setEmailMessages([])
    } finally {
      setLoadingEmails(false)
    }
  }, [expandedQuote])

  const previewAttachment = useCallback(async (msg: EmailMessage, att: EmailMessage['attachments'][0]) => {
    setDownloadingAtt(`${msg.id}_${att.id}`)
    try {
      const tempPath = await window.api.presscal.downloadAttachment(msg.id, att.id, att.mimeType, att.filename)
      // Store quote context so CostingDialog can use it
      if (expandedQuote) {
        useAppStore.setState({ attachmentQuoteId: expandedQuote })
      }
      // Navigate to the temp file — triggers preview
      await window.api.fs.getMetadata(tempPath).then(meta => {
        selectFile({
          name: att.filename,
          path: tempPath,
          size: att.size,
          isDirectory: false,
          type: getTypeFromMime(att.mimeType),
          extension: '.' + att.filename.split('.').pop(),
          modified: new Date().toISOString()
        })
      }).catch(() => {
        // Fallback: open externally
        window.api.shell.openPath(tempPath)
      })
    } catch (e) {
      console.error('Download attachment failed:', e)
    } finally {
      setDownloadingAtt(null)
    }
  }, [selectFile])

  const statusColors: Record<string, string> = {
    draft: 'text-text-muted',
    sent: 'text-info',
    approved: 'text-success',
    partial: 'text-warning',
    rejected: 'text-error',
    completed: 'text-text-muted'
  }

  const isImage = (mime: string) => mime.startsWith('image/')

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', height: 36, background: 'var(--th-bg-primary)', borderRadius: 8 }}>
        <Search size={14} style={{ color: 'var(--th-text-muted)', flexShrink: 0 }} />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search quotes..."
          style={{
            border: 'none', background: 'transparent', color: 'var(--th-text-primary)',
            fontSize: 13, outline: 'none', width: '100%', padding: 0, margin: 0,
          }}
        />
      </div>

      {/* Status filter tabs */}
      {statuses.length > 1 && (
        <div className="flex items-center" style={{ gap: 4, flexWrap: 'wrap' }}>
          <button
            style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 11, border: 'none', cursor: 'pointer',
              background: !filterStatus ? 'rgba(110,200,200,0.12)' : 'transparent',
              color: !filterStatus ? 'var(--th-accent)' : 'var(--th-text-muted)',
            }}
            onClick={() => setFilterStatus('')}
          >
            All ({activeQuotes.length})
          </button>
          {statuses.map(status => (
            <button
              key={status}
              style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11, border: 'none', cursor: 'pointer',
                background: filterStatus === status ? 'rgba(110,200,200,0.12)' : 'transparent',
                color: filterStatus === status ? 'var(--th-accent)' : 'var(--th-text-muted)',
                textTransform: 'capitalize',
              }}
              onClick={() => setFilterStatus(status)}
            >
              {STATUS_LABELS[status] || status} ({activeQuotes.filter(q => q.status === status).length})
            </button>
          ))}
        </div>
      )}

      {/* Current file */}
      {selectedFile && !selectedFile.isDirectory && (
        <div style={{ padding: '10px 12px' }} className="bg-bg-primary rounded-lg text-sm text-text-secondary leading-relaxed">
          Linking: <span className="text-text-primary font-medium">{selectedFile.name}</span>
          <span className="text-text-muted ml-1.5">({formatFileSize(selectedFile.size)})</span>
        </div>
      )}

      {/* Quote list */}
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 size={20} className="animate-spin text-text-muted" />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {quotes.map(quote => {
            const linked = isLinked(quote.id)
            const expanded = expandedQuote === quote.id
            return (
              <div key={quote.id} className="rounded-lg overflow-hidden">
                {/* Quote row — click to open quote folder */}
                <div
                  className="flex items-center gap-3 rounded-lg hover:bg-bg-hover group cursor-pointer"
                  style={{ padding: '12px 12px' }}
                  onClick={() => openQuoteFolder(quote)}
                >
                  {/* Expand toggle */}
                  <button
                    className="flex-shrink-0 text-text-muted hover:text-text-primary"
                    onClick={(e) => { e.stopPropagation(); toggleExpand(quote.id) }}
                  >
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>

                  <FileText size={18} className={statusColors[quote.status] || 'text-text-muted'} />

                  <div className="flex-1 min-w-0" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-accent">{quote.number}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${statusColors[quote.status]} bg-bg-primary`}>
                        {quote.status}
                      </span>
                    </div>
                    <div className="text-sm text-text-secondary truncate leading-relaxed">
                      {quote.title || (quote.customerName && quote.customerName !== '–' ? quote.customerName : null) || 'Untitled'}
                    </div>
                    {quote.grandTotal > 0 && (
                      <div className="text-sm text-text-muted">
                        {quote.grandTotal.toFixed(2)} EUR
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0" onClick={() => !linked && linkToQuote(quote.id)}>
                    {linkingTo === quote.id ? (
                      <Loader2 size={16} className="animate-spin text-accent" />
                    ) : linked ? (
                      <CheckCircle size={16} className="text-success" />
                    ) : (
                      <Link2 size={16} className="text-text-muted opacity-0 group-hover:opacity-100" />
                    )}
                  </div>
                </div>

                {/* Expanded: email attachments */}
                {expanded && (
                  <div style={{ padding: '8px 12px 16px 40px' }} className="bg-bg-primary/50">
                    {loadingEmails ? (
                      <div className="flex items-center gap-2 py-4">
                        <Loader2 size={14} className="animate-spin text-text-muted" />
                        <span className="text-xs text-text-muted">Loading emails...</span>
                      </div>
                    ) : emailMessages.length === 0 ? (
                      <div className="text-xs text-text-muted py-3">No linked emails</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {emailMessages.map(msg => (
                          <div key={msg.id}>
                            {/* Email header */}
                            <div style={{ marginBottom: 8 }}>
                              <div className="text-xs text-text-secondary font-medium truncate">{msg.subject || '(no subject)'}</div>
                              <div className="text-xs text-text-muted">{msg.from?.split('<')[0]?.trim()}</div>
                            </div>

                            {/* Attachments */}
                            {msg.attachments.length > 0 ? (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {msg.attachments.map(att => {
                                  const attKey = `${msg.id}_${att.id}`
                                  const downloading = downloadingAtt === attKey
                                  return (
                                    <button
                                      key={attKey}
                                      className="flex items-center gap-2 bg-bg-primary border border-border rounded-lg hover:border-accent/50 hover:bg-bg-hover transition-colors"
                                      style={{ padding: '8px 12px', maxWidth: 200 }}
                                      onClick={() => previewAttachment(msg, att)}
                                      disabled={downloading}
                                      title={`${att.filename} (${formatFileSize(att.size)})`}
                                    >
                                      {downloading ? (
                                        <Loader2 size={14} className="animate-spin text-accent flex-shrink-0" />
                                      ) : isImage(att.mimeType) ? (
                                        <Image size={14} className="text-accent flex-shrink-0" />
                                      ) : (
                                        <Paperclip size={14} className="text-text-muted flex-shrink-0" />
                                      )}
                                      <span className="text-xs text-text-secondary truncate">{att.filename}</span>
                                    </button>
                                  )
                                })}
                              </div>
                            ) : (
                              <div className="text-xs text-text-muted">No attachments</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {quotes.length === 0 && !loading && (
            <div className="text-center py-8 text-sm text-text-muted">
              {search ? 'No quotes found' : 'No quotes'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function getTypeFromMime(mime: string): any {
  if (mime.startsWith('image/jpeg') || mime.startsWith('image/jpg')) return 'jpg'
  if (mime.startsWith('image/png')) return 'png'
  if (mime.startsWith('image/tiff')) return 'tiff'
  if (mime.startsWith('image/svg')) return 'svg'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('image/')) return 'jpg'
  return 'other'
}
