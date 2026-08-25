import { useEffect, useState } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { AppDialog } from './components/layout/AppDialog'
import { useAppStore } from './stores/app-store'
import { useDialogStore } from './stores/dialog-store'
import { Loader2 } from 'lucide-react'
import type { PresscalCustomer } from './lib/ipc'
import { deleteFiles } from './lib/delete-files'

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
  push(customer.email, customer.name || customer.company || 'Company', 'company')
  push(customer.companyEmail, customer.name || customer.company || 'Company', 'company')

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
      const name = c.name || [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || 'Contact'
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
    // Build search index in background after 10s delay.
    // Gives Everything time to start (if available), and lets UI fully load.
    // If Everything is running, buildIndex skips entirely (no SQLite work).
    const timer = setTimeout(() => {
      window.api.search.buildIndex().then(r => {
        if (r.count > 0) console.log(`Search index: ${r.count} files in ${r.ms}ms`)
      }).catch(() => {})
    }, 10000)
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
      // Backspace — navigate up to parent folder
      if (e.key === 'Backspace') {
        e.preventDefault()
        useAppStore.getState().navigateUp()
        return
      }
      // Delete key — trash selected files
      if (e.key === 'Delete') {
        const { selectedFiles, selectedFile, clearSelection, refreshDirectory } = useAppStore.getState()
        const filesToDelete = selectedFiles.length > 0
          ? selectedFiles
          : selectedFile ? [selectedFile] : []
        if (filesToDelete.length === 0) return
        e.preventDefault()
        const { showConfirm, showAlert } = useDialogStore.getState()
        deleteFiles(filesToDelete, { showConfirm, showAlert }).then(() => {
          // Small delay before refresh — let filesystem settle (Dropbox, indexer, etc.)
          clearSelection()
          setTimeout(() => refreshDirectory(), 200)
        })
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

  // Listen for folder navigation from PressCal — reuse existing tab if same path
  useEffect(() => {
    const cleanup = window.api.deepLink.onNavigateToFolder(({ path, email, quoteId }: any) => {
      const normalized = path.replace(/[\\/]+$/, '').toLowerCase()
      const { tabs } = useAppStore.getState()
      const existing = tabs.find(t => t.currentPath.replace(/[\\/]+$/, '').toLowerCase() === normalized)
      if (existing) {
        useAppStore.getState().setActiveTab(existing.id)
      } else {
        useAppStore.getState().addTab(path)
      }
      // Always reset email state on new navigation — stale data from
      // a previous customer/quote must not carry over.
      // Bump emailDetectSeq to force the auto-detect effect to re-run
      // even if path + quoteId are identical to the previous navigation.
      useAppStore.setState({
        lastCustomerEmail: email || '',
        lastCustomerEmailOptions: [],
        attachmentQuoteId: quoteId || '',
        emailDetectSeq: useAppStore.getState().emailDetectSeq + 1,
      })
      // Auto-open preview panel when navigating from PressCal
      if (!useAppStore.getState().previewOpen) {
        useAppStore.getState().togglePreview()
      }
    })

    return cleanup
  }, [])

  // File system watcher — auto refresh when files change (debounced to avoid
  // re-render storms during Dropbox sync or bulk file operations)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = window.api.fs.onChanged((dirPath: string) => {
      const { currentPath } = useAppStore.getState()
      if (currentPath !== dirPath) return
      clearTimeout(timer)
      timer = setTimeout(() => useAppStore.getState().refreshDirectory(), 800)
    })
    return () => { clearTimeout(timer); cleanup() }
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
  const emailDetectSeq = useAppStore(s => s.emailDetectSeq)

  useEffect(() => {
    // Clear immediately on path/tab change — before any async work
    useAppStore.setState({ detectedCustomer: null, detectedQuote: null })

    if (!presscalConnected) return
    if (!currentPath && !knownQuoteId) return
    let cancelled = false

    const run = async () => {
      // Always try reading .presskit file from current or parent dirs — it's more
      // reliable than the stale attachmentQuoteId which may be from a previous deep link.
      let effectiveQuoteId = ''
      if (currentPath) {
        const components = currentPath.replace(/\\/g, '/').split('/').filter(Boolean)
        // Walk from current dir upward looking for .presskit
        for (let i = components.length; i >= 1; i--) {
          try {
            const dir = components.slice(0, i).join('/')
            const buf = await window.api.fs.readFile(dir + '/.presskit')
            if (cancelled) return
            const text = new TextDecoder().decode(buf)
            const parsed = JSON.parse(text)
            if (parsed.quoteId) {
              effectiveQuoteId = parsed.quoteId
              break
            }
          } catch {}
        }
      }
      // Fall back to deep-link quoteId if .presskit was not found
      if (!effectiveQuoteId) effectiveQuoteId = knownQuoteId

      // Strategy 1: resolve via quoteId from .presskit or deep link.
      if (effectiveQuoteId) {
        let resolvedCustomerId: string | null = null
        let resolvedCustomerName: string | null = null
        let directEmail: string | null = null // contactEmail or senderEmail fallback

        // Helper: extract customer/email fields from a full quote detail object
        const applyQuoteDetail = (q: any): void => {
          if (!q || q.error) return
          if (!resolvedCustomerId) resolvedCustomerId = q.customerId || q.companyId || null
          if (!resolvedCustomerName) resolvedCustomerName = q.customerName || q.companyName || q.contactName || null
          if (!directEmail) directEmail = q.contactEmail || q.senderEmail || q.email || null
        }

        // 1a) Single-quote endpoint (works with internal ID)
        try {
          const quote = await window.api.presscal.getQuote(effectiveQuoteId)
          if (cancelled) return
          applyQuoteDetail(quote)
        } catch {}

        // 1b) Fall back to getQuotes list — then fetch full detail for contactEmail
        if (!resolvedCustomerId && !resolvedCustomerName && !directEmail) {
          try {
            const quotes = await window.api.presscal.getQuotes({})
            if (cancelled) return
            const q = quotes.find((x: any) => x.id === effectiveQuoteId || x.number === effectiveQuoteId)
            if (q) {
              // Store detected quote for contextual panel
              useAppStore.setState({
                detectedQuote: { id: q.id, number: q.number, status: q.status, title: q.title, customerName: q.customerName }
              })
              // List response lacks contactEmail — fetch full detail by internal ID
              try {
                const detail = await window.api.presscal.getQuote(q.id)
                if (cancelled) return
                applyQuoteDetail(detail)
              } catch {
                // Fall back to list fields
                applyQuoteDetail(q)
              }
            }
          } catch {}
        }

        // 1c) Fall back to getJobs list (active quotes exposed as jobs)
        if (!resolvedCustomerId && !resolvedCustomerName && !directEmail) {
          try {
            const jobs = await window.api.presscal.getJobs()
            if (cancelled) return
            const j = jobs.find((x: any) => x.id === effectiveQuoteId || x.number === effectiveQuoteId)
            if (j) {
              resolvedCustomerId = j.customerId || j.companyId || null
              if (!resolvedCustomerId) resolvedCustomerName = j.customerName || j.companyName || null
              if (!directEmail) directEmail = j.contactEmail || j.senderEmail || j.email || null
            }
          } catch {}
        }

        // 1d) Turn customer id/name into email via direct API fetch + cached list
        if (resolvedCustomerId || resolvedCustomerName) {
          let customer: PresscalCustomer | undefined

          // Try direct fetch by ID first (cached list may not include this customer)
          if (resolvedCustomerId) {
            try {
              const fetched = await window.api.presscal.getCustomer(resolvedCustomerId)
              if (cancelled) return
              if (fetched && typeof fetched === 'object') {
                customer = fetched
              }
            } catch {}
          }

          // Fall back to cached list
          if (!customer) {
            const customers = await getCachedCustomers()
            if (cancelled) return
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
          }

          // Fall back to search API by name (when ID lookup fails, e.g. companyId ≠ customerId)
          if (!customer && resolvedCustomerName) {
            try {
              const searchResults = await window.api.presscal.getCustomers(resolvedCustomerName)
              if (cancelled) return
              const needle = resolvedCustomerName.toLowerCase().trim()
              customer = searchResults.find((c: any) =>
                c.name?.toLowerCase().trim() === needle ||
                c.company?.toLowerCase().trim() === needle
              ) || (searchResults.length === 1 ? searchResults[0] : undefined)
            } catch {}
          }
          const options = extractEmailOptions(customer)
          // Also include directEmail (contactEmail/senderEmail from quote) if not already present
          if (directEmail) {
            const already = options.some(o => o.email.toLowerCase() === directEmail!.toLowerCase())
            if (!already) {
              options.push({ label: 'Quote email', email: directEmail, kind: 'contact' as const })
            }
          }
          // Store detected customer for contextual panel
          if (customer) {
            useAppStore.setState({
              detectedCustomer: { id: customer.id, name: customer.name, company: customer.company, email: customer.email }
            })
          }
          if (options.length > 0) {
            useAppStore.setState({
              lastCustomerEmail: options[0].email,
              lastCustomerEmailOptions: options
            })
            return
          }
        }

        // 1e) Fallback: use contactEmail or senderEmail directly from quote
        if (directEmail) {
          useAppStore.setState({
            lastCustomerEmail: directEmail,
            lastCustomerEmailOptions: [{ label: 'Quote email', email: directEmail, kind: 'contact' as const }]
          })
          return
        }
      }

      // Strategy 1b: extract quote number from folder name pattern [QT-xxxx-xxxx]
      // and resolve via API (covers the common case where quoteId was not in the deep link).
      // Scan ALL path components (not just the last) — user may be in a subfolder.
      if (!currentPath) return
      const pathComponents = currentPath.replace(/\\/g, '/').split('/').filter(Boolean)
      let quoteNumberMatch: RegExpMatchArray | null = null
      for (let i = pathComponents.length - 1; i >= 0; i--) {
        quoteNumberMatch = pathComponents[i].match(/\[QT[- ](\d{4}[- ]\d{4})\]/)
        if (quoteNumberMatch) break
      }
      if (quoteNumberMatch) {
        const quoteNumber = 'QT-' + quoteNumberMatch[1].replace(/\s/g, '-')
        try {
          const quotes = await window.api.presscal.getQuotes({})
          if (cancelled) return
          const q = quotes.find((x: any) => {
            const num = (x.number || '').toUpperCase()
            return num === quoteNumber.toUpperCase()
          })
          if (q) {
            // Fetch full quote detail (list lacks contactEmail)
            let fullQuote = q
            try {
              const detail = await window.api.presscal.getQuote(q.id)
              if (cancelled) return
              if (detail && !detail.error) fullQuote = detail
            } catch {}

            // Store detected quote
            useAppStore.setState({
              detectedQuote: { id: q.id, number: q.number, status: q.status, title: q.title, customerName: fullQuote.customerName || fullQuote.contactName || q.customerName }
            })
            const customers = await getCachedCustomers()
            if (cancelled) return
            let customer: PresscalCustomer | undefined
            const custId = fullQuote.customerId || fullQuote.companyId || q.customerId
            const custName = fullQuote.customerName || fullQuote.companyName || fullQuote.contactName || q.customerName
            if (custId) customer = customers.find(c => c.id === custId)
            if (!customer && custName) {
              const needle = custName.toLowerCase().trim()
              customer = customers.find(c =>
                c.name?.toLowerCase().trim() === needle ||
                c.company?.toLowerCase().trim() === needle
              )
            }
            if (customer) {
              useAppStore.setState({
                detectedCustomer: { id: customer.id, name: customer.name, company: customer.company, email: customer.email }
              })
            }
            const directEmail = fullQuote.contactEmail || fullQuote.senderEmail || null
            const options = extractEmailOptions(customer)
            if (directEmail) {
              const already = options.some(o => o.email.toLowerCase() === directEmail!.toLowerCase())
              if (!already) options.push({ label: 'Quote email', email: directEmail, kind: 'contact' as const })
            }
            if (options.length > 0) {
              useAppStore.setState({ lastCustomerEmail: options[0].email, lastCustomerEmailOptions: options })
              return
            }
            if (directEmail) {
              useAppStore.setState({
                lastCustomerEmail: directEmail,
                lastCustomerEmailOptions: [{ label: 'Quote email', email: directEmail, kind: 'contact' as const }]
              })
              return
            }
          }
        } catch {}
      }

      // Strategy 2 + 3: path-based matching against cached customer list
      const customers = await getCachedCustomers()
      if (cancelled) return

      let match = findCustomerByPath(customers, currentPath)
      if (!match) {
        match = findCustomerByName(customers, currentPath)
      }

      // Strategy 4: use PressCal's own search API with keywords from the
      // deepest folder name. Skip numbers, quote codes, and generic words
      // that would produce false-positive matches.
      if (!match) {
        const skipWords = new Set(['fwd', 'fw_', 're_', 'πελάτης', 'πελατης', 'done', 'final', 'draft', 'copy'])
        const keywords = folderBasename
          .split(/[\s\-_,.()[\]]+/)
          .map(w => w.trim())
          .filter(w => w.length >= 4 && !/^\d+$/.test(w) && !/^QT$/i.test(w) && !skipWords.has(w.toLowerCase()))
        for (const kw of keywords) {
          try {
            const results = await window.api.presscal.getCustomers(kw)
            if (cancelled) return
            if (results.length > 0) {
              // ONLY use exact/substring match — never fallback to results[0]
              const lcBase = folderBasename.toLowerCase()
              const exact = results.find(r => {
                const n = (r.name || '').toLowerCase()
                const c = (r.company || '').toLowerCase()
                return (n && n.length >= 4 && lcBase.includes(n)) || (c && c.length >= 4 && lcBase.includes(c))
              })
              if (exact) {
                match = exact
                break
              }
            }
          } catch {}
        }
      }

      if (match) {
        useAppStore.setState({
          detectedCustomer: { id: match.id, name: match.name, company: match.company, email: match.email }
        })
        const options = extractEmailOptions(match)
        if (options.length > 0) {
          useAppStore.setState({
            lastCustomerEmail: options[0].email,
            lastCustomerEmailOptions: options
          })
        } else {
          // Clear stale options from a previous customer
          useAppStore.setState({ lastCustomerEmailOptions: [] })
        }
      }
    }

    run()
    return () => { cancelled = true }
  }, [currentPath, presscalConnected, knownQuoteId, emailDetectSeq])

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

  // Listen for in-app alerts/confirms from main process (replaces native dialogs)
  useEffect(() => {
    const cleanupAlert = window.api.deepLink.onShowAlert(({ title, message }) => {
      useDialogStore.getState().showAlert(message, title)
    })
    const cleanupConfirm = window.api.deepLink.onShowConfirm(async ({ id, title, message }) => {
      const result = await useDialogStore.getState().showConfirm(message, title)
      window.api.deepLink.respondConfirm(id, result)
    })
    const cleanupChoice = window.api.deepLink.onShowChoice(async ({ id, title, message, choices }) => {
      const result = await useDialogStore.getState().showChoice(message, choices, title)
      window.api.deepLink.respondChoice(id, result)
    })
    return () => { cleanupAlert(); cleanupConfirm(); cleanupChoice() }
  }, [])

  return (
    <>
      <AppLayout />
      <AppDialog />
      {dlProgress && !dlProgress.done && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          background: 'var(--th-bg-tertiary, #1e293b)', border: '1px solid var(--th-border, #334155)',
          borderRadius: 12, padding: '16px 20px', minWidth: 280, maxWidth: 360,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <Loader2 size={16} style={{ color: 'var(--th-accent)', animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--th-text-primary, #e2e8f0)' }}>
              Downloading files...
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
                  height: '100%', borderRadius: 2, background: 'var(--th-accent)',
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
