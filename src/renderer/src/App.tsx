import { useEffect, useState } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { useAppStore } from './stores/app-store'
import { Loader2 } from 'lucide-react'
import type { PresscalCustomer } from './lib/ipc'

interface DeepLinkProgress {
  step: string
  current: number
  total: number
  done: boolean
}

// ─── Customer-by-folder cache ─────────────────────────────────────────────
// Used to auto-fill the customer email in the Send Email dialog whenever
// the user is browsing inside a customer's folder. Cached because the
// customer list rarely changes within a session and we lookup on every
// navigation.
let customersCache: PresscalCustomer[] | null = null
let customersCachedAt = 0
const CUSTOMERS_CACHE_MS = 5 * 60 * 1000 // 5 minutes

async function getCachedCustomers(): Promise<PresscalCustomer[]> {
  const now = Date.now()
  if (customersCache && now - customersCachedAt < CUSTOMERS_CACHE_MS) {
    return customersCache
  }
  try {
    const customers = await window.api.presscal.getCustomers()
    customersCache = customers
    customersCachedAt = now
    return customers
  } catch {
    return customersCache || []
  }
}

// Return the customer whose folderPath is the longest prefix match of
// `path`. Longest-match handles nested customer folders correctly.
function findCustomerByPath(customers: PresscalCustomer[], path: string): PresscalCustomer | null {
  const norm = path.replace(/\\/g, '/').toLowerCase()
  let best: PresscalCustomer | null = null
  let bestLen = 0
  for (const c of customers) {
    if (!c.folderPath) continue
    const folder = c.folderPath.replace(/\\/g, '/').toLowerCase()
    if ((norm === folder || norm.startsWith(folder + '/')) && folder.length > bestLen) {
      best = c
      bestLen = folder.length
    }
  }
  return best
}

// Extract every plausible email + label from a PressCal customer object.
// The API returns the base company fields but also (depending on version)
// nested contacts under one of several field names — we handle all of them.
// Returns entries ordered: company first, then contacts.
type EmailOption = { label: string; email: string; kind: 'company' | 'contact' }

function extractEmailOptions(customer: any): EmailOption[] {
  if (!customer) return []
  const seen = new Set<string>()
  const out: EmailOption[] = []
  const push = (email: unknown, label: string, kind: 'company' | 'contact'): void => {
    if (typeof email !== 'string') return
    const e = email.trim()
    if (!e || !e.includes('@')) return
    const key = e.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push({ email: e, label: label || e, kind })
  }

  // Company-level email (multiple possible field names)
  push(customer.email, customer.name || customer.company || 'Εταιρεία', 'company')
  push(customer.companyEmail, customer.name || customer.company || 'Εταιρεία', 'company')

  // Contacts array under various possible property names
  const contactArrays: any[] = [
    customer.contacts,
    customer.contactPersons,
    customer.persons,
    customer.people,
  ].filter(Array.isArray)
  for (const arr of contactArrays) {
    for (const c of arr) {
      if (!c) continue
      const name = c.name || [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || 'Επαφή'
      push(c.email, name, 'contact')
      // Some schemas use `emails: string[]`
      if (Array.isArray(c.emails)) {
        for (const e of c.emails) push(e, name, 'contact')
      }
    }
  }
  return out
}

// Fallback matcher: when customers don't have a folderPath set (common
// case), try to match by name. Walks every component of the path (deepest
// first) and looks for a customer whose name or company appears in that
// component. Picks the longest/most-specific name to avoid false matches
// from generic short names.
function findCustomerByName(customers: PresscalCustomer[], path: string): PresscalCustomer | null {
  const components = path.replace(/\\/g, '/').split('/').filter(Boolean)
  // Walk deepest → shallowest so nested customer folders win over parents
  for (let i = components.length - 1; i >= 0; i--) {
    const comp = components[i].toLowerCase()
    let best: PresscalCustomer | null = null
    let bestLen = 0
    for (const c of customers) {
      const candidates = [c.name, c.company].filter(Boolean) as string[]
      for (const cand of candidates) {
        const lc = cand.toLowerCase().trim()
        // Require at least 4 chars to avoid noise matches like "A" or "SA"
        if (lc.length < 4) continue
        if (comp.includes(lc) && lc.length > bestLen) {
          best = c
          bestLen = lc.length
        }
      }
    }
    if (best) return best
  }
  return null
}

export default function App() {
  const loadSettings = useAppStore(s => s.loadSettings)
  const selectFile = useAppStore(s => s.selectFile)
  const navigateTo = useAppStore(s => s.navigateTo)
  const [dlProgress, setDlProgress] = useState<DeepLinkProgress | null>(null)

  useEffect(() => {
    console.log('[PressKit] App mounted — build includes email-autofill v2')
    loadSettings()
    // Build search index in background after 3s delay (let UI load first)
    const timer = setTimeout(() => {
      window.api.search.buildIndex().then(r => {
        if (r.count > 0) console.log(`Search index: ${r.count} files in ${r.ms}ms`)
      }).catch(() => {})
    }, 3000)
    return () => clearTimeout(timer)
  }, [loadSettings])

  // Tab keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Escape closes fullscreen preview
      if (e.key === 'Escape' && useAppStore.getState().fullscreenPreview) {
        useAppStore.setState({ fullscreenPreview: false })
        return
      }
      // Use e.code for shortcuts — works regardless of keyboard layout (EN/GR)
      if (e.ctrlKey && e.code === 'KeyT') {
        e.preventDefault()
        useAppStore.getState().addTab()
      }
      if (e.ctrlKey && e.code === 'KeyW') {
        e.preventDefault()
        const { tabs, activeTabId, closeTab } = useAppStore.getState()
        if (tabs.length > 1) closeTab(activeTabId)
      }
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault()
        const { tabs, activeTabId, setActiveTab } = useAppStore.getState()
        const idx = tabs.findIndex(t => t.id === activeTabId)
        const nextIdx = e.shiftKey
          ? (idx - 1 + tabs.length) % tabs.length
          : (idx + 1) % tabs.length
        setActiveTab(tabs[nextIdx].id)
      }
      // File operations — only when not typing in an input
      const tag = (e.target as HTMLElement).tagName
      const editable = (e.target as HTMLElement).isContentEditable
      if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) return
      if (e.code === 'Space') {
        e.preventDefault()
        e.stopImmediatePropagation()
        const { fullscreenPreview, selectedFile } = useAppStore.getState()

        if (fullscreenPreview) {
          useAppStore.setState({ fullscreenPreview: false })
        } else if (selectedFile && !selectedFile.isDirectory) {
          useAppStore.setState({ fullscreenPreview: true })
        }
        return
      }
      if (e.ctrlKey && e.code === 'KeyC') {
        e.preventDefault()
        useAppStore.getState().copyFiles()
      }
      if (e.ctrlKey && e.code === 'KeyX') {
        e.preventDefault()
        useAppStore.getState().cutFiles()
      }
      if (e.ctrlKey && e.code === 'KeyV') {
        e.preventDefault()
        useAppStore.getState().pasteFiles()
      }
      if (e.ctrlKey && e.code === 'KeyA') {
        e.preventDefault()
        useAppStore.getState().selectAll()
      }
      // P key — toggle pick on selected files
      if (e.code === 'KeyP' && !e.ctrlKey) {
        e.preventDefault()
        useAppStore.getState().togglePickSelected()
      }
      // Delete key — trash selected files
      if (e.key === 'Delete') {
        const { selectedFiles, selectedFile, clearSelection, refreshDirectory } = useAppStore.getState()
        const filesToDelete = selectedFiles.length > 0
          ? selectedFiles
          : selectedFile ? [selectedFile] : []
        if (filesToDelete.length === 0) return
        e.preventDefault()
        const names = filesToDelete.length === 1
          ? `"${filesToDelete[0].name}"`
          : `${filesToDelete.length} αρχεία`
        if (confirm(`Διαγραφή ${names};`)) {
          window.api.fs.trash(filesToDelete.map(f => f.path)).then((results: any[]) => {
            const failed = results.filter((r: any) => !r.ok)
            if (failed.length > 0) {
              alert(`Αποτυχία διαγραφής ${failed.length} αρχείων:\n${failed.map((f: any) => f.error).join('\n')}`)
            }
            // Small delay before refresh — let filesystem settle (Dropbox, indexer, etc.)
            clearSelection()
            setTimeout(() => refreshDirectory(), 200)
          })
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Listen for deep link attachments from PressCal
  useEffect(() => {
    const cleanup = window.api.deepLink.onOpenAttachment(({ tempPath, filename, mime, quoteId }) => {
      const ext = '.' + filename.split('.').pop()
      const type = mime.startsWith('image/') ? 'jpg'
        : mime === 'application/pdf' ? 'pdf'
        : 'other'

      useAppStore.setState({ attachmentQuoteId: quoteId || '' })

      // Open preview panel if closed
      if (!useAppStore.getState().previewOpen) {
        useAppStore.getState().togglePreview()
      }

      selectFile(null as any)
      setTimeout(() => {
        selectFile({
          name: filename,
          path: tempPath,
          size: 0,
          isDirectory: false,
          type,
          extension: ext,
          modified: new Date().toISOString()
        })
      }, 50)
    })

    return cleanup
  }, [selectFile])

  // Listen for folder navigation from PressCal
  useEffect(() => {
    const cleanup = window.api.deepLink.onNavigateToFolder(({ path, email, quoteId }: any) => {
      navigateTo(path)
      if (email) {
        useAppStore.setState({ lastCustomerEmail: email })
      }
      // Remember which quote this folder belongs to
      if (quoteId) {
        useAppStore.setState({ attachmentQuoteId: quoteId })
      }
      // Auto-open preview panel when navigating from PressCal
      if (!useAppStore.getState().previewOpen) {
        useAppStore.getState().togglePreview()
      }
    })

    return cleanup
  }, [navigateTo])

  // File system watcher — auto refresh when files change
  useEffect(() => {
    const cleanup = window.api.fs.onChanged((dirPath: string) => {
      const { currentPath, refreshDirectory } = useAppStore.getState()
      if (currentPath === dirPath) {
        refreshDirectory()
      }
    })
    return cleanup
  }, [])

  // Auto-detect customer email. Tries three strategies in order:
  //   1) Known quoteId (from deep link) → fetch quote → customer → email.
  //      Most reliable — the quote tells us exactly which customer.
  //   2) Exact folderPath prefix match against the customer list.
  //   3) Fuzzy name match: customer name appearing in a path component.
  const currentPath = useAppStore(s => s.currentPath)
  const presscalConnected = useAppStore(s => s.presscalConnected)
  const attachmentQuoteId = useAppStore(s => s.attachmentQuoteId)
  const pickFileQuoteId = useAppStore(s => s.pickFileMode?.quoteId)
  const knownQuoteId = attachmentQuoteId || pickFileQuoteId || ''

  useEffect(() => {
    if (!presscalConnected) {
      console.log('[email-autofill] skipped — presscal not connected')
      return
    }
    if (!currentPath && !knownQuoteId) return
    let cancelled = false

    const run = async () => {
      // Strategy 1: resolve via quoteId from deep link. Try single endpoint
      // first, fall back to the list endpoint + find-by-id, then finally
      // the jobs list (PressCal surfaces "active quotes" as jobs).
      if (knownQuoteId) {
        console.log(`[email-autofill] resolving via quoteId: ${knownQuoteId}`)
        let resolvedCustomerId: string | null = null
        let resolvedCustomerName: string | null = null

        // 1a) Single-quote endpoint
        try {
          const quote = await window.api.presscal.getQuote(knownQuoteId)
          if (cancelled) return
          if (quote?.customerId) resolvedCustomerId = quote.customerId
          else if (quote?.customerName) resolvedCustomerName = quote.customerName
        } catch (err: any) {
          console.log('[email-autofill] getQuote failed, trying list:', err.message || err)
        }

        // 1b) Fall back to getQuotes list
        if (!resolvedCustomerId && !resolvedCustomerName) {
          try {
            const quotes = await window.api.presscal.getQuotes({})
            if (cancelled) return
            const q = quotes.find((x: any) => x.id === knownQuoteId)
            if (q?.customerId) resolvedCustomerId = q.customerId
            else if (q?.customerName) resolvedCustomerName = q.customerName
            else console.log('[email-autofill] quoteId not in getQuotes list')
          } catch (err: any) {
            console.log('[email-autofill] getQuotes failed:', err.message || err)
          }
        }

        // 1c) Fall back to getJobs list (active quotes exposed as jobs)
        if (!resolvedCustomerId && !resolvedCustomerName) {
          try {
            const jobs = await window.api.presscal.getJobs()
            if (cancelled) return
            const j = jobs.find((x: any) => x.id === knownQuoteId)
            if (j?.customerId) resolvedCustomerId = j.customerId
            else if (j?.customerName) resolvedCustomerName = j.customerName
            else console.log('[email-autofill] quoteId not in getJobs list')
          } catch (err: any) {
            console.log('[email-autofill] getJobs failed:', err.message || err)
          }
        }

        // 1d) Turn customer id/name into email via cached customer list
        if (resolvedCustomerId || resolvedCustomerName) {
          const customers = await getCachedCustomers()
          if (cancelled) return
          let customer: PresscalCustomer | undefined
          if (resolvedCustomerId) {
            customer = customers.find(c => c.id === resolvedCustomerId)
          }
          if (!customer && resolvedCustomerName) {
            const needle = resolvedCustomerName.toLowerCase().trim()
            customer = customers.find(c =>
              c.name?.toLowerCase().trim() === needle ||
              c.company?.toLowerCase().trim() === needle
            )
          }
          const options = extractEmailOptions(customer)
          if (options.length > 0) {
            console.log(`[email-autofill] MATCH via quoteId: ${customer?.name}, ${options.length} email(s)`)
            useAppStore.setState({
              lastCustomerEmail: options[0].email,
              lastCustomerEmailOptions: options
            })
            return
          }
          console.warn('[email-autofill] resolved customer has no email:', customer || { resolvedCustomerId, resolvedCustomerName })
        }
      }

      // Strategy 2 + 3: path-based matching against cached customer list
      if (!currentPath) return
      const customers = await getCachedCustomers()
      if (cancelled) return
      const withFolder = customers.filter(c => c.folderPath)
      console.log(`[email-autofill] currentPath: "${currentPath}"`)
      console.log(`[email-autofill] customers: ${customers.length} total, ${withFolder.length} with folderPath`)

      let match = findCustomerByPath(customers, currentPath)
      let via = 'folderPath'
      if (!match) {
        match = findCustomerByName(customers, currentPath)
        via = 'name'
      }

      // Strategy 4: use PressCal's own search API with keywords from the
      // deepest folder name. Useful when the cached customer list is
      // paginated/truncated (we only got 50) and the needed customer
      // wasn't included.
      if (!match) {
        const basename = currentPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() || ''
        // Split on common separators and keep meaningful words (>= 4 chars)
        const keywords = basename
          .split(/[\s\-_,.()[\]]+/)
          .map(w => w.trim())
          .filter(w => w.length >= 4)
        console.log(`[email-autofill] trying PressCal search with keywords:`, keywords)
        for (const kw of keywords) {
          try {
            const results = await window.api.presscal.getCustomers(kw)
            if (cancelled) return
            console.log(`[email-autofill] search "${kw}" → ${results.length} results`)
            if (results.length > 0) {
              // Prefer an exact/substring match on name or company
              const lcBase = basename.toLowerCase()
              const exact = results.find(r => {
                const n = (r.name || '').toLowerCase()
                const c = (r.company || '').toLowerCase()
                return (n && lcBase.includes(n)) || (c && lcBase.includes(c))
              })
              match = exact || results[0]
              via = `search("${kw}")`
              break
            }
          } catch (err: any) {
            console.log(`[email-autofill] search failed for "${kw}":`, err.message || err)
          }
        }
      }

      if (match) {
        console.log(`[email-autofill] MATCH via ${via}: ${match.name}`)
        console.log('[email-autofill] match object keys:', Object.keys(match as any))
        const options = extractEmailOptions(match)
        console.log('[email-autofill] email options extracted:', options)
        if (options.length > 0) {
          useAppStore.setState({
            lastCustomerEmail: options[0].email,
            lastCustomerEmailOptions: options
          })
        } else {
          console.warn('[email-autofill] no emails found on customer:', match.name)
          // Clear stale options from a previous customer
          useAppStore.setState({ lastCustomerEmailOptions: [] })
        }
      } else {
        console.log('[email-autofill] no match')
      }
    }

    run()
    return () => { cancelled = true }
  }, [currentPath, presscalConnected, knownQuoteId])

  // Listen for pick-file mode from PressCal
  useEffect(() => {
    const cleanup = window.api.deepLink.onPickFileMode(({ quoteId, itemId }) => {
      useAppStore.setState({
        pickFileMode: { quoteId, itemId }
      })
    })

    return cleanup
  }, [])

  // Deep link progress (download-to-folder etc.)
  useEffect(() => {
    const cleanup = window.api.deepLink.onProgress((data) => {
      if (data.done) {
        // Keep visible briefly so user sees "done"
        setTimeout(() => setDlProgress(null), 800)
      }
      setDlProgress(data)
    })
    return cleanup
  }, [])

  return (
    <>
      <AppLayout />
      {dlProgress && !dlProgress.done && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          background: 'var(--th-bg-tertiary, #1e293b)', border: '1px solid var(--th-border, #334155)',
          borderRadius: 12, padding: '16px 20px', minWidth: 280, maxWidth: 360,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <Loader2 size={16} style={{ color: '#f58220', animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--th-text-primary, #e2e8f0)' }}>
              Λήψη αρχείων...
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--th-text-secondary, #94a3b8)', marginBottom: 8 }}>
            {dlProgress.step}
          </div>
          {dlProgress.total > 0 && (
            <>
              <div style={{
                height: 4, borderRadius: 2, background: 'var(--th-bg-primary, #0f172a)',
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', borderRadius: 2, background: '#f58220',
                  width: `${Math.round((dlProgress.current / dlProgress.total) * 100)}%`,
                  transition: 'width 0.3s ease',
                }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--th-text-muted, #64748b)', marginTop: 6, textAlign: 'right' }}>
                {dlProgress.current} / {dlProgress.total}
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
