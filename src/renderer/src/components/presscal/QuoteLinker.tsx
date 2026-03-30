import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@/stores/app-store'
import {
  Search, Link2, FileText,
  Loader2, CheckCircle
} from 'lucide-react'
import type { PresscalQuote, FileLink } from '@/lib/ipc'
import { formatFileSize } from '@/lib/file-types'

export function QuoteLinker() {
  const { selectedFile, preflight } = useAppStore()
  const [quotes, setQuotes] = useState<PresscalQuote[]>([])
  const [fileLinks, setFileLinks] = useState<FileLink[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [linkingTo, setLinkingTo] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    window.api.presscal.getQuotes({ search: search || undefined })
      .then(setQuotes)
      .catch(() => setQuotes([]))
      .finally(() => setLoading(false))
  }, [search])

  useEffect(() => {
    if (!selectedFile) return
    window.api.presscal.getFileLinks({})
      .then(setFileLinks)
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
      setFileLinks(links)
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

  const statusColors: Record<string, string> = {
    draft: 'text-text-muted',
    sent: 'text-info',
    approved: 'text-success',
    partial: 'text-warning',
    rejected: 'text-error',
    completed: 'text-text-muted'
  }

  return (
    <div className="p-4 space-y-4">
      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search quotes..."
          className="w-full pl-9 pr-3 py-2.5 bg-bg-primary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
        />
      </div>

      {/* Current file */}
      {selectedFile && !selectedFile.isDirectory && (
        <div className="px-3 py-2.5 bg-bg-primary rounded-lg text-sm text-text-secondary leading-relaxed">
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
        <div className="space-y-1.5">
          {quotes.map(quote => {
            const linked = isLinked(quote.id)
            return (
              <div
                key={quote.id}
                className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-bg-hover group cursor-pointer"
                onClick={() => !linked && linkToQuote(quote.id)}
              >
                <FileText size={18} className={statusColors[quote.status] || 'text-text-muted'} />

                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-accent">{quote.number}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${statusColors[quote.status]} bg-bg-primary`}>
                      {quote.status}
                    </span>
                  </div>
                  <div className="text-sm text-text-secondary truncate leading-relaxed">
                    {quote.title || quote.customerName || 'Untitled'}
                  </div>
                  {quote.grandTotal > 0 && (
                    <div className="text-sm text-text-muted">
                      {quote.grandTotal.toFixed(2)} EUR
                    </div>
                  )}
                </div>

                {linkingTo === quote.id ? (
                  <Loader2 size={16} className="animate-spin text-accent flex-shrink-0" />
                ) : linked ? (
                  <CheckCircle size={16} className="text-success flex-shrink-0" />
                ) : (
                  <Link2 size={16} className="text-text-muted opacity-0 group-hover:opacity-100 flex-shrink-0" />
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
