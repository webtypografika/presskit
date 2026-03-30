import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@/stores/app-store'
import {
  Search, User, Building2, Mail,
  Loader2, Link2, Tag
} from 'lucide-react'
import type { PresscalCustomer } from '@/lib/ipc'

export function CustomerPicker() {
  const { selectedFile, preflight } = useAppStore()
  const [customers, setCustomers] = useState<PresscalCustomer[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [linkingTo, setLinkingTo] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    window.api.presscal.getCustomers(search || undefined)
      .then(setCustomers)
      .catch(() => setCustomers([]))
      .finally(() => setLoading(false))
  }, [search])

  const linkToCustomer = useCallback(async (customerId: string) => {
    if (!selectedFile || selectedFile.isDirectory) return
    setLinkingTo(customerId)
    try {
      await window.api.presscal.linkFile({
        fileName: selectedFile.name,
        filePath: selectedFile.path,
        fileType: selectedFile.extension,
        fileSize: selectedFile.size,
        source: 'local',
        customerId,
        preflightStatus: preflight?.overallStatus || undefined
      })
    } catch {
    } finally {
      setLinkingTo(null)
    }
  }, [selectedFile, preflight])

  return (
    <div className="p-4 space-y-4">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search clients..."
          className="w-full pl-9 pr-3 py-2.5 bg-bg-primary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 size={20} className="animate-spin text-text-muted" />
        </div>
      ) : (
        <div className="space-y-1.5">
          {customers.map(customer => (
            <div
              key={customer.id}
              className="px-3 py-3 rounded-lg hover:bg-bg-hover group cursor-pointer"
              onClick={() => linkToCustomer(customer.id)}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                  <User size={16} className="text-accent" />
                </div>

                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="text-sm font-medium text-text-primary">{customer.name}</div>
                  {customer.company && (
                    <div className="flex items-center gap-1.5 text-sm text-text-muted">
                      <Building2 size={12} />
                      <span className="truncate">{customer.company}</span>
                    </div>
                  )}
                  {customer.email && (
                    <div className="flex items-center gap-1.5 text-sm text-text-muted">
                      <Mail size={12} />
                      <span className="truncate">{customer.email}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-sm text-text-muted">{customer.quoteCount}</span>
                  {linkingTo === customer.id ? (
                    <Loader2 size={15} className="animate-spin text-accent" />
                  ) : (
                    <Link2 size={15} className="text-text-muted opacity-0 group-hover:opacity-100" />
                  )}
                </div>
              </div>

              {customer.tags && customer.tags.length > 0 && (
                <div className="flex items-center gap-1.5 mt-2 ml-12">
                  {customer.tags.slice(0, 3).map(tag => (
                    <span key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-bg-primary rounded-md text-xs text-text-muted">
                      <Tag size={10} />{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}

          {customers.length === 0 && !loading && (
            <div className="text-center py-8 text-sm text-text-muted">
              {search ? 'No clients found' : 'No clients'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
