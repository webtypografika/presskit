import {
  ArrowLeft, ArrowRight, ArrowUp, RefreshCw,
  LayoutGrid, List, Scan,
  HardDrive, Cloud, Layers, RefreshCcw, Search, Send,
  PanelLeft, PanelRight, Eye, EyeOff,
  Pencil, Package, RectangleHorizontal,
  FolderPlus, Archive, Clock, X
} from 'lucide-react'
import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { FileTypeIcon } from '../browser/FileTypeIcon'
import type { FileType } from '@/lib/file-types'
import { fileTypeRank, typesInOrder, typeWordQuery, getFileTypeLabel } from '@/lib/file-types'
import { useAppStore } from '@/stores/app-store'
import { useShallow } from 'zustand/react/shallow'
import type { PresscalCustomer } from '@/lib/ipc'
import { Breadcrumb } from '../browser/Breadcrumb'
import { BatchPreflightPanel } from '../batch/BatchPreflightPanel'
import { ConvertDialog } from '../convert/ConvertDialog'
import { FilePackager } from '../tools/FilePackager'

export type OverlayMode = 'none' | 'batch' | 'convert'

export function Toolbar() {
  const viewMode = useAppStore(s => s.viewMode)
  const source = useAppStore(s => s.source)
  const selectedFile = useAppStore(s => s.selectedFile)
  const selectedFiles = useAppStore(s => s.selectedFiles)
  const pathHistory = useAppStore(s => s.pathHistory)
  const historyIndex = useAppStore(s => s.historyIndex)
  const currentPath = useAppStore(s => s.currentPath)
  const showSidebar = useAppStore(s => s.showSidebar)
  const showInspector = useAppStore(s => s.showInspector)
  const previewOpen = useAppStore(s => s.previewOpen)
  const thumbnailSize = useAppStore(s => s.thumbnailSize)
  const {
    navigateBack, navigateForward, navigateUp, refreshDirectory,
    setViewMode, setSource, runPreflight,
    setShowSidebar, setShowInspector,
    togglePreview, setThumbnailSize, requestNewFolder
  } = useAppStore(useShallow(s => ({
    navigateBack: s.navigateBack,
    navigateForward: s.navigateForward,
    navigateUp: s.navigateUp,
    refreshDirectory: s.refreshDirectory,
    setViewMode: s.setViewMode,
    setSource: s.setSource,
    runPreflight: s.runPreflight,
    setShowSidebar: s.setShowSidebar,
    setShowInspector: s.setShowInspector,
    togglePreview: s.togglePreview,
    setThumbnailSize: s.setThumbnailSize,
    requestNewFolder: s.requestNewFolder,
  })))

  const convertRequested = useAppStore(s => s.convertRequested)
  const clearConvertRequest = useAppStore(s => s.clearConvertRequest)

  const [overlay, setOverlay] = useState<OverlayMode>('none')
  const [showSendEmail, setShowSendEmail] = useState(false)
  const [showPackager, setShowPackager] = useState(false)

  // Open convert dialog when requested from context menu (store-based trigger)
  useEffect(() => {
    if (convertRequested) {
      setOverlay('convert')
      clearConvertRequest()
    }
  }, [convertRequested, clearConvertRequest])

  // Files to send = multi-selected or single selected
  const filesToSend = selectedFiles.length > 0
    ? selectedFiles.filter(f => !f.isDirectory)
    : (selectedFile && !selectedFile.isDirectory ? [selectedFile] : [])

  const canGoBack = historyIndex > 0
  const canGoForward = historyIndex < pathHistory.length - 1
  const canPreflight = selectedFile && !selectedFile.isDirectory

  // Archive is only relevant when viewing a quote folder (basename starts with "[QT-")
  // and not already inside _01 Archive.
  const currentFolderName = currentPath ? currentPath.split(/[\\/]/).pop() || '' : ''
  const isQuoteFolder = /^\[QT[-_]/i.test(currentFolderName)
  const alreadyInArchive = /[\\/]_01 Archive[\\/]/i.test(currentPath)
  const canArchive = isQuoteFolder && !alreadyInArchive

  const handleArchive = useCallback(async () => {
    if (!currentPath) return
    try {
      await window.api.archive.quoteFolder(currentPath)
    } catch (e) {
      console.error('[ARCHIVE]', e)
    }
  }, [currentPath])

  return (
    <>
      {/* Row 1: Main toolbar with labels */}
      <div className="titlebar-no-drag flex items-center flex-shrink-0" style={{ height: 52, padding: '0 16px' }}>

        {/* Sidebar toggle */}
        <LabeledButton icon={<PanelLeft size={16} />} label="Sidebar" onClick={() => setShowSidebar(!showSidebar)} active={showSidebar} />

        <div className="w-px h-7 bg-border flex-shrink-0" style={{ margin: '0 10px' }} />

        {/* Navigation */}
        <div className="flex items-center" style={{ gap: 4, padding: '4px 8px', background: 'var(--th-bg-primary)', borderRadius: 10 }}>
          <ToolbarButton icon={<ArrowLeft size={18} />} onClick={navigateBack} disabled={!canGoBack} title="Back" />
          <ToolbarButton icon={<ArrowRight size={18} />} onClick={navigateForward} disabled={!canGoForward} title="Forward" />
          <ToolbarButton icon={<ArrowUp size={18} />} onClick={navigateUp} title="Up" />
          <ToolbarButton icon={<RefreshCw size={18} />} onClick={refreshDirectory} title="Refresh" />
          <ToolbarButton icon={<FolderPlus size={18} />} onClick={requestNewFolder} title="New Folder" />
        </div>

        <div className="w-px h-7 bg-border flex-shrink-0" style={{ margin: '0 14px' }} />

        {/* Panels */}
        <div className="flex items-center" style={{ gap: 4 }}>
          <LabeledButton icon={previewOpen ? <Eye size={16} /> : <EyeOff size={16} />} label="Preview" onClick={togglePreview} active={previewOpen} />
        </div>

        <div className="w-px h-7 bg-border flex-shrink-0" style={{ margin: '0 10px' }} />

        {/* File actions */}
        <div className="flex items-center" style={{ gap: 4 }}>
          <LabeledButton icon={<Scan size={16} />} label="Preflight" onClick={runPreflight} disabled={!canPreflight} accent />
          <LabeledButton icon={<Layers size={16} />} label="Batch" onClick={() => setOverlay(overlay === 'batch' ? 'none' : 'batch')} active={overlay === 'batch'} />
          <LabeledButton icon={<RefreshCcw size={16} />} label="Convert" onClick={() => setOverlay(overlay === 'convert' ? 'none' : 'convert')} active={overlay === 'convert'} disabled={!canPreflight} />
          <LabeledButton icon={<Package size={16} />} label="Collect" onClick={() => setShowPackager(true)} />
          {canArchive && (
            <LabeledButton icon={<Archive size={16} />} label="Archive" onClick={handleArchive} />
          )}
        </div>

        {/* Send email */}
        {filesToSend.length > 0 && (
          <>
            <div className="w-px h-7 bg-border flex-shrink-0" style={{ margin: '0 10px' }} />
            <button
              onClick={() => setShowSendEmail(true)}
              className="flex items-center rounded-lg transition-colors"
              style={{
                gap: 6, padding: '6px 16px', fontSize: 13, fontWeight: 600,
                background: 'rgba(110,200,200,0.1)', color: 'var(--th-accent)', border: '1px solid rgba(110,200,200,0.3)',
                cursor: 'pointer',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(110,200,200,0.2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(110,200,200,0.1)')}
            >
              <Send size={14} />
              Send {filesToSend.length > 1 ? `(${filesToSend.length})` : ''}
            </button>
          </>
        )}

        <div className="flex-1" />

        {/* View mode + size slider */}
        <div className="flex items-center" style={{ gap: 4 }}>
          <LabeledButton icon={<LayoutGrid size={16} />} label="Grid" onClick={() => setViewMode('grid')} active={viewMode === 'grid'} />
          <LabeledButton icon={<List size={16} />} label="List" onClick={() => setViewMode('list')} active={viewMode === 'list'} />
          {viewMode === 'grid' && (
            <input
              type="range"
              min={64}
              max={256}
              step={8}
              value={thumbnailSize}
              onChange={e => setThumbnailSize(Number(e.target.value))}
              title={`${thumbnailSize}px`}
              style={{ width: 80, marginLeft: 6, accentColor: 'var(--th-accent)', cursor: 'pointer' }}
            />
          )}
        </div>

        <div className="w-px h-7 bg-border flex-shrink-0" style={{ margin: '0 10px' }} />

        {/* Inspector toggle */}
        <LabeledButton icon={<PanelRight size={16} />} label="Inspector" onClick={() => setShowInspector(!showInspector)} active={showInspector} />
      </div>

      {/* Divider */}
      <div className="border-b border-border" style={{ margin: '0 16px' }} />

      {/* Row 2: Source + Path + Search */}
      <div className="titlebar-no-drag flex items-center flex-shrink-0" style={{ height: 36, gap: 10, padding: '4px 16px' }}>
        {/* Source toggle */}
        <div className="flex items-center bg-bg-primary rounded-md flex-shrink-0" style={{ padding: 2 }}>
          <button
            className="flex items-center rounded transition-colors"
            style={{
              gap: 4, padding: '2px 10px', fontSize: 12, minHeight: 'auto',
              background: source === 'local' ? 'var(--th-accent-subtle)' : 'transparent',
              color: source === 'local' ? 'var(--th-accent)' : 'var(--th-text-secondary)',
            }}
            onClick={() => setSource('local')}
          >
            <HardDrive size={13} /> Local
          </button>
          <button
            className="flex items-center rounded transition-colors"
            style={{
              gap: 4, padding: '2px 10px', fontSize: 12, minHeight: 'auto',
              background: source === 'dropbox' ? 'var(--th-accent-subtle)' : 'transparent',
              color: source === 'dropbox' ? 'var(--th-accent)' : 'var(--th-text-secondary)',
            }}
            onClick={() => setSource('dropbox')}
          >
            <Cloud size={13} /> Dropbox
          </button>
        </div>

        <div className="w-px h-4 bg-border flex-shrink-0" />

        {/* Breadcrumb */}
        <div className="flex-1 min-w-0">
          <Breadcrumb />
        </div>

        <div className="w-px h-4 bg-border flex-shrink-0" />

        {/* Search */}
        <div className="flex-shrink-0">
          <SearchBox />
        </div>
      </div>

      {/* Bottom divider */}
      <div className="border-b border-border" style={{ margin: '0 16px' }} />

      {/* Overlay panels */}
      {overlay === 'batch' && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}>
          <div style={{ width: '90%', maxWidth: 1200, height: '80%', borderRadius: 12, overflow: 'hidden' }}>
            <BatchPreflightPanel onClose={() => setOverlay('none')} />
          </div>
        </div>,
        document.body
      )}
      {overlay === 'convert' && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.3)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setOverlay('none') }}
        >
          <div style={{ width: 440, maxHeight: '70vh', borderRadius: 14, overflow: 'hidden', background: 'var(--th-bg-secondary)', boxShadow: '0 8px 40px rgba(0,0,0,0.25)', border: '1px solid var(--th-border)' }}>
            <ConvertDialog onClose={() => setOverlay('none')} />
          </div>
        </div>,
        document.body
      )}

      {showSendEmail && <SendEmailDialog files={filesToSend} onClose={() => setShowSendEmail(false)} />}
      {showPackager && <FilePackager onClose={() => setShowPackager(false)} />}
    </>
  )
}

function ToolbarButton({ icon, onClick, disabled, active, accent, title }: {
  icon: React.ReactNode
  onClick: () => void
  disabled?: boolean
  active?: boolean
  accent?: boolean
  title?: string
}) {
  return (
    <button
      className={`rounded-lg transition-colors ${
        disabled
          ? 'text-text-muted cursor-not-allowed'
          : active
            ? 'text-accent bg-bg-active'
            : accent
              ? 'text-accent hover:bg-bg-hover'
              : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
      }`}
      style={{ padding: 10, margin: 2 }}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {icon}
    </button>
  )
}

function LabeledButton({ icon, label, onClick, disabled, active, accent }: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  accent?: boolean
}) {
  return (
    <button
      className={`flex items-center rounded-lg transition-colors ${
        disabled
          ? 'text-text-muted cursor-not-allowed'
          : active
            ? 'text-accent bg-bg-active'
            : accent
              ? 'text-accent hover:bg-bg-hover'
              : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
      }`}
      style={{ gap: 6, padding: '6px 12px', fontSize: 13 }}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

// Map raw PressCal / Gmail API errors to user-friendly Greek messages.
// The raw errors are long JSON blobs that aren't useful in a dialog.
function friendlyEmailError(e: any): string {
  const raw = String(e?.message || e || '')

  // Gmail OAuth expired / invalid
  if (
    raw.includes('UNAUTHENTICATED') ||
    raw.includes('Invalid Credentials') ||
    raw.includes('invalid authentication credentials') ||
    /Gmail send failed[\s\S]*401/.test(raw)
  ) {
    return 'Your Gmail connection has expired. Log out and back in to PressCal, then try again.'
  }

  // Gmail quota / rate limit
  if (raw.includes('quotaExceeded') || raw.includes('rateLimitExceeded')) {
    return 'Gmail sending limit reached. Try again in a few minutes.'
  }

  // Invalid recipient
  if (raw.includes('Invalid To header') || raw.includes('invalid recipient')) {
    return 'Invalid recipient address.'
  }

  // PressCal not configured
  if (raw.includes('PressCal not configured')) {
    return 'PressCal is not configured. Go to Settings.'
  }

  // Attachment too large (Vercel body limit or Gmail 25MB limit)
  if (raw.includes('too large') || raw.includes('Message size') ||
      raw.includes('Request Entity Too Large') || raw.includes('PAYLOAD_TOO_LARGE') ||
      raw.includes('413')) {
    return 'The files are too large to send by email (25 MB limit). Try WeTransfer or a Dropbox link.'
  }

  // SMTP / BadCredentials from direct Gmail send
  if (raw.includes('BadCredentials') || raw.includes('Username and Password not accepted') ||
      raw.includes('Invalid login') || raw.includes('535-5.7.8')) {
    return 'Your Gmail connection has expired. Log out and back in to PressCal, then try again.'
  }

  // Generic 500 — strip the stack and keep a short line
  const m = raw.match(/PressCal API error: \d+ [^—]+(?:— (.+))?/)
  if (m) {
    const detail = m[1]?.split('\n')[0]?.slice(0, 200) || 'Unknown server error'
    return `Send failed: ${detail}`
  }

  return raw || 'Failed to send email'
}

function SendEmailDialog({ files, onClose }: { files: any[]; onClose: () => void }) {
  const presscalConnected = useAppStore(s => s.presscalConnected)
  const lastCustomerEmail = useAppStore(s => s.lastCustomerEmail)
  const lastCustomerEmailOptions = useAppStore(s => s.lastCustomerEmailOptions)
  const attachmentQuoteId = useAppStore(s => s.attachmentQuoteId)
  const pickFileQuoteId = useAppStore(s => s.pickFileMode?.quoteId)
  const currentQuoteId = attachmentQuoteId || pickFileQuoteId || ''
  const [to, setTo] = useState(lastCustomerEmail || '')
  const [subject, setSubject] = useState('Files for approval')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [emailMenuOpen, setEmailMenuOpen] = useState(false)

  // Sync when auto-detect resolves after dialog opened
  const prevEmail = useRef(lastCustomerEmail)
  useEffect(() => {
    if (lastCustomerEmail && lastCustomerEmail !== prevEmail.current && !to) {
      setTo(lastCustomerEmail)
    }
    prevEmail.current = lastCustomerEmail
  }, [lastCustomerEmail]) // eslint-disable-line react-hooks/exhaustive-deps

  // Customer search autocomplete — live search via API
  const [customerSuggestions, setCustomerSuggestions] = useState<PresscalCustomer[]>([])
  const [showCustomerSearch, setShowCustomerSearch] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!presscalConnected) return
    const query = to.trim()
    if (!query || (query.includes('@') && query.includes('.'))) {
      setCustomerSuggestions([])
      return
    }
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      window.api.presscal.getCustomers(query)
        .then(data => {
          const withEmail = (data || []).filter(c => c.email)
          setCustomerSuggestions(withEmail.slice(0, 8))
        })
        .catch(() => setCustomerSuggestions([]))
    }, 250)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [to, presscalConnected])

  const totalSize = files.reduce((s, f) => s + (f.size || 0), 0)

  const sendOnce = async () => {
    await window.api.presscal.sendEmailWithFiles({
      to: to.trim(),
      subject: subject.trim(),
      body: body.trim(),
      filePaths: files.map((f: any) => ({ path: f.path, name: f.name, ext: f.extension })),
      quoteId: currentQuoteId || undefined
    })
  }

  const handleSend = async () => {
    if (!to.trim() || !subject.trim()) return
    setSending(true)
    setError('')

    try {
      await sendOnce()
      setSent(true)
      setTimeout(onClose, 1500)
    } catch (e: any) {
      console.error('[EMAIL] Raw error:', e?.message || e)
      const raw = String(e?.message || '')
      const isAuthError = raw.includes('UNAUTHENTICATED') || raw.includes('Invalid Credentials') ||
        raw.includes('invalid authentication credentials') || /Gmail send failed[\s\S]*401/.test(raw)

      if (isAuthError) {
        // Auto-retry once — session may have refreshed server-side
        console.log('[EMAIL] Auth error, retrying once...')
        try {
          await sendOnce()
          setSent(true)
          setTimeout(onClose, 1500)
          return
        } catch (e2: any) {
          console.error('[EMAIL] Retry also failed:', e2?.message || e2)
          setError(friendlyEmailError(e2))
        }
      } else {
        setError(friendlyEmailError(e))
      }
    } finally {
      setSending(false)
    }
  }

  if (!presscalConnected) {
    return createPortal(
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}>
        <div style={{ width: 400, background: 'var(--th-bg-secondary)', borderRadius: 14, border: '1px solid var(--th-border)', padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: 'var(--th-text-muted)', marginBottom: 16 }}>Connect to PressCal first (Settings → PressCal)</div>
          <button onClick={onClose} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid var(--th-border)', background: 'transparent', color: 'var(--th-text-muted)', cursor: 'pointer' }}>OK</button>
        </div>
      </div>,
      document.body
    )
  }

  const inp: React.CSSProperties = {
    width: '100%', padding: '10px 14px', borderRadius: 8,
    background: 'var(--th-bg-primary)', border: '1px solid var(--th-border)', color: 'var(--th-text-primary)',
    fontSize: 14, outline: 'none',
  }

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}>
      <div style={{ width: 500, maxHeight: '80vh', display: 'flex', flexDirection: 'column', background: 'var(--th-bg-secondary)', borderRadius: 14, border: '1px solid var(--th-border)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--th-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Send size={18} style={{ color: 'var(--th-accent)' }} />
          <span style={{ fontSize: 16, fontWeight: 600, flex: 1, color: 'var(--th-text-primary)' }}>Send Email</span>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: 'var(--th-text-muted)', cursor: 'pointer', fontSize: 18 }}>&times;</button>
        </div>

        {/* Attachments */}
        <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--th-border)', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {files.map((f, i) => (
            <span key={i} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 6,
              background: 'rgba(110,200,200,0.08)', border: '1px solid rgba(110,200,200,0.2)',
              fontSize: 12, color: 'var(--th-accent)',
            }}>
              📎 {f.name}
            </span>
          ))}
          <span style={{ fontSize: 11, color: 'var(--th-text-muted)', alignSelf: 'center', marginLeft: 4 }}>
            {files.length} file{files.length === 1 ? '' : 's'} · {formatSize(totalSize)}
          </span>
        </div>
        {totalSize > 25 * 1024 * 1024 && (
          <div style={{ padding: '8px 24px', background: 'rgba(239,68,68,0.08)', borderBottom: '1px solid var(--th-border)', fontSize: 12, color: '#ef4444' }}>
            The files exceed 25 MB — they cannot be sent by email. Try WeTransfer or a Dropbox link.
          </div>
        )}

        {/* Form */}
        <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12, flex: 1, overflow: 'auto' }}>
          <div style={{ position: 'relative' }}>
            <label style={{ fontSize: 12, color: 'var(--th-text-muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>To</label>
            <div style={{ position: 'relative' }}>
              <input
                value={to}
                onChange={e => { setTo(e.target.value); setShowCustomerSearch(true) }}
                onFocus={() => {
                  if (lastCustomerEmailOptions.length > 0) setEmailMenuOpen(true)
                  else setShowCustomerSearch(true)
                }}
                onBlur={() => setTimeout(() => { setEmailMenuOpen(false); setShowCustomerSearch(false) }, 200)}
                placeholder="email or customer name..."
                style={{ ...inp, paddingRight: lastCustomerEmailOptions.length > 1 ? 36 : 14 }}
                autoFocus
              />
              {lastCustomerEmailOptions.length > 1 && (
                <button
                  type="button"
                  onClick={() => setEmailMenuOpen(o => !o)}
                  title="Available customer emails"
                  style={{
                    position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                    width: 26, height: 26, borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: 'transparent', color: 'var(--th-text-muted)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  ▾
                </button>
              )}
              {/* Deep-link email options dropdown */}
              {emailMenuOpen && lastCustomerEmailOptions.length > 0 && customerSuggestions.length === 0 && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100,
                  background: 'var(--th-bg-tertiary, var(--th-bg-secondary))',
                  border: '1px solid var(--th-border)', borderRadius: 8,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.3)', overflow: 'hidden',
                }}>
                  {lastCustomerEmailOptions.map((opt, i) => (
                    <button
                      key={opt.email + i}
                      type="button"
                      onMouseDown={e => {
                        e.preventDefault()
                        setTo(opt.email)
                        setEmailMenuOpen(false)
                      }}
                      style={{
                        width: '100%', padding: '10px 14px', border: 'none', cursor: 'pointer',
                        background: to === opt.email ? 'rgba(110,200,200,0.12)' : 'transparent',
                        textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 2,
                        borderBottom: i < lastCustomerEmailOptions.length - 1 ? '1px solid var(--th-border)' : 'none',
                      }}
                      onMouseEnter={e => { if (to !== opt.email) e.currentTarget.style.background = 'var(--th-bg-hover)' }}
                      onMouseLeave={e => { if (to !== opt.email) e.currentTarget.style.background = 'transparent' }}
                    >
                      <span style={{ fontSize: 13, color: 'var(--th-text-primary)', fontWeight: 500 }}>
                        {opt.label}
                        <span style={{
                          marginLeft: 6, fontSize: 10, padding: '1px 6px', borderRadius: 4,
                          background: opt.kind === 'company' ? 'rgba(110,200,200,0.15)' : 'rgba(100,116,139,0.15)',
                          color: opt.kind === 'company' ? 'var(--th-accent)' : 'var(--th-text-muted)',
                          fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em',
                        }}>
                          {opt.kind === 'company' ? 'company' : 'contact'}
                        </span>
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--th-text-muted)' }}>{opt.email}</span>
                    </button>
                  ))}
                </div>
              )}
              {/* Customer search autocomplete (when no deep-link context) */}
              {showCustomerSearch && customerSuggestions.length > 0 && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100,
                  background: 'var(--th-bg-tertiary, var(--th-bg-secondary))',
                  border: '1px solid var(--th-border)', borderRadius: 8,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.3)', overflow: 'hidden',
                  maxHeight: 280, overflowY: 'auto',
                }}>
                  {customerSuggestions.map((c, i) => (
                    <button
                      key={c.id}
                      type="button"
                      onMouseDown={e => {
                        e.preventDefault()
                        setTo(c.email || '')
                        setShowCustomerSearch(false)
                      }}
                      style={{
                        width: '100%', padding: '10px 14px', border: 'none', cursor: 'pointer',
                        background: 'transparent', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 2,
                        borderBottom: i < customerSuggestions.length - 1 ? '1px solid var(--th-border)' : 'none',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--th-bg-hover)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <span style={{ fontSize: 13, color: 'var(--th-text-primary)', fontWeight: 500 }}>
                        {c.name}
                        {c.company && (
                          <span style={{
                            marginLeft: 6, fontSize: 11, color: 'var(--th-text-muted)', fontWeight: 400,
                          }}>
                            {c.company}
                          </span>
                        )}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--th-text-muted)' }}>{c.email}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--th-text-muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Files for approval" style={inp} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--th-text-muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Message</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Please find the files attached..." rows={4} style={{ ...inp, resize: 'vertical' }} />
          </div>

          {error && (
            <div style={{ fontSize: 13, color: '#ef4444', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span>{error}</span>
              <button
                onClick={handleSend}
                disabled={sending}
                style={{
                  alignSelf: 'flex-start', padding: '6px 14px', borderRadius: 6, fontSize: 12,
                  border: '1px solid #ef4444', background: 'transparent', color: '#ef4444',
                  cursor: 'pointer', opacity: sending ? 0.5 : 1,
                }}
              >
                Try again
              </button>
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--th-border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid var(--th-border)', background: 'transparent', color: 'var(--th-text-muted)', fontSize: 14, cursor: 'pointer' }}>
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending || sent || !to.trim() || !subject.trim() || totalSize > 25 * 1024 * 1024}
            style={{
              padding: '10px 24px', borderRadius: 8, border: 'none',
              background: sent ? '#22c55e' : 'var(--th-accent)', color: '#fff',
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
              opacity: (sending || !to.trim() || !subject.trim()) ? 0.5 : 1,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {sending ? 'Sending...' : sent ? '✓ Sent!' : <><Send size={14} /> Send</>}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

function getMimeType(ext: string): string {
  const types: Record<string, string> = {
    '.pdf': 'application/pdf', '.ai': 'application/postscript', '.psd': 'image/vnd.adobe.photoshop',
    '.eps': 'application/postscript', '.tif': 'image/tiff', '.tiff': 'image/tiff',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.indd': 'application/x-indesign',
  }
  return types[ext] || 'application/octet-stream'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

/** The folder a hit sits in, for the second line of the row. */
const dirOf = (p: string) => p.replace(/[/\\][^/\\]+$/, '')

/** Only what lives under `root`. Case-insensitive, separator-agnostic, and it
 *  compares whole segments so "retail-9" never matches "retail-90". With no
 *  folder open there is nothing to be outside of, so everything passes. */
const withinScope = (rows: any[], root: string) => {
  if (!root) return rows
  const base = root.replace(/[/\\]+$/, '').toLowerCase().replace(/\//g, '\\') + '\\'
  return rows.filter(f => String(f.path || '').toLowerCase().replace(/\//g, '\\').startsWith(base))
}

/** Folders first, then PDFs, then Illustrator… — never the same type twice in
 *  the list with something else in between. Ties keep the engine's own order,
 *  which is relevance. */
const sortByType = (rows: any[]) => rows
  .map((f, i) => ({ f, i }))
  .sort((a, b) => (fileTypeRank(a.f.type) - fileTypeRank(b.f.type)) || (a.i - b.i))
  .map(x => x.f)

/** A search hit, in the shape the file list speaks. */
const mapHit = (item: any) => ({
  name: item.name,
  path: item.path,
  isDirectory: item.is_dir === 1,
  size: item.size || 0,
  modified: item.modified ? new Date(item.modified).toISOString() : '',
  extension: item.ext || '',
  // The engine says what kind of file this is now, so the dropdown draws the
  // same icon as the file list instead of guessing with emoji.
  type: item.type || (item.is_dir === 1 ? 'folder' : 'unknown'),
  _dir: item.dir,
})

function SearchBox() {
  const selectFile = useAppStore(s => s.selectFile)
  const navigateTo = useAppStore(s => s.navigateTo)
  const currentPath = useAppStore(s => s.currentPath)
  const source = useAppStore(s => s.source)
  const [query, setQuery] = useState('')
  const queryRef = useRef('')
  const [results, setResults] = useState<any[]>([])
  // null = every type. Set by the chips, or by searching for a bare "pdf".
  const [typeFilter, setTypeFilter] = useState<FileType | null>(null)
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [searchHistory, setSearchHistory] = useState<{ query: string; time: string }[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const inputRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<any>(null)
  // Which search is the current one. See doSearch.
  const seqRef = useRef(0)

  // Load search history on mount
  useEffect(() => {
    window.api.settings.get('search.history').then((h: any) => setSearchHistory(h || [])).catch(() => {})
  }, [])

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      return
    }
    // Only the newest search may touch the screen.
    //
    // The 150ms debounce delays the START of a search, not its finish: typing
    // p-d-f at normal speed starts three, and each one runs an index query plus
    // a live folder walk that is allowed five seconds. The broad early query is
    // the slow one, so it lands LAST and repaints the list with the results for
    // "p" — more rows than before, filter off. From the chair it looks like the
    // filter adds instead of narrowing (George, 30/09, γραφείο). Worst exactly
    // where it matters: folders full of Dropbox online-only files, where every
    // stat() is a network call.
    const seq = ++seqRef.current
    const stale = () => seqRef.current !== seq
    setSearching(true)
    try {
      const trimmed = q.trim()
      // "pdf" means the PDFs here, not the files called pdf. Both engines match
      // on the name, and every PDF's name ends in .pdf — so the word becomes the
      // extension and the matching chip lights up (George, 30/09).
      const asType = typeWordQuery(trimmed)
      const needle = asType ? asType.ext : trimmed
      setTypeFilter(asType ? asType.type : null)

      // A Dropbox tab is not the local disk. Its paths are Dropbox paths, which
      // the local index and Everything cannot see at all — this box was searching
      // C:\ while you stood in /typografika/graphics/…, which is why hits kept
      // coming from outside the folder (George, 30/09). Dropbox searches its own
      // side, scoped to the same folder.
      if (source === 'dropbox') {
        const hits = await window.api.dropbox.search(needle, currentPath || undefined)
        if (stale()) return
        setResults(sortByType((hits || []).map((f: any) => ({ ...f, _dir: dirOf(f.path) }))))
        setOpen(true)
        setShowHistory(false)
        window.api.settings.addSearchHistory(trimmed).then((h: any) => setSearchHistory(h || [])).catch(() => {})
        return
      }

      // 1. This folder — the one you are looking at, and the one you meant. The
      //    whole disk used to answer, so a search inside a customer's folder came
      //    back with every other customer (George, 29/09).
      const indexResults = await window.api.search.query(needle, 200, currentPath || undefined)
      if (stale()) return
      const mapped = (indexResults || []).map(mapHit)

      // 2. Thin result? The live walk of this same folder catches what the index
      //    has not seen yet — a file saved a minute ago.
      if (mapped.length < 10 && currentPath) {
        try {
          const liveResults = await window.api.fs.search(currentPath, needle, 200)
          if (stale()) return
          const seen = new Set(mapped.map((m: any) => m.path))
          for (const f of (liveResults || [])) {
            if (!seen.has(f.path)) {
              mapped.push({ ...f, _dir: f.path.replace(/[/\\][^/\\]+$/, '') })
              seen.add(f.path)
            }
          }
        } catch {}
      }

      // And that is the whole search: this folder and below. To search wider you
      // go wider — stand on dropbox/typografika and the search covers typografika
      // (George, 30/09).
      //
      // The last word is this filter, not the engines. Three separate things have
      // now reached outside the folder — a second results group, a live walk that
      // climbed to the parent, and before them the unscoped index — so the rule is
      // enforced where it cannot be argued with rather than trusted to each of
      // them. Anything outside is dropped, whoever returned it.
      if (stale()) return
      setResults(sortByType(withinScope(mapped, currentPath)))
      setOpen(true)
      setShowHistory(false)
      // Save to search history
      window.api.settings.addSearchHistory(trimmed).then((h: any) => setSearchHistory(h || [])).catch(() => {})
    } catch (e) {
      console.error('[SEARCH] error:', e)
      if (!stale()) setResults([])
    } finally {
      if (!stale()) setSearching(false)
    }
  }, [currentPath, source])

  const handleChange = useCallback((val: string) => {
    setQuery(val)
    queryRef.current = val
    if (!val.trim()) {
      setShowHistory(searchHistory.length > 0)
      setOpen(false)
      setResults([])
      if (timerRef.current) clearTimeout(timerRef.current)
      return
    }
    setShowHistory(false)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSearch(val), 150)
  }, [doSearch, searchHistory.length])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (timerRef.current) clearTimeout(timerRef.current)
      doSearch(queryRef.current)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      setShowHistory(false)
      setResults([])
      ;(e.target as HTMLElement).blur()
    }
  }, [doSearch])

  const handleSelect = useCallback(async (file: any) => {
    if (file.isDirectory) {
      navigateTo(file.path)
    } else {
      // Navigate to the file's parent folder, then select the file
      const parentDir = file._dir || file.path.replace(/[/\\][^/\\]+$/, '')
      if (parentDir && parentDir !== currentPath) {
        await navigateTo(parentDir)
      }
      // Small delay to let the directory load, then select
      setTimeout(() => selectFile(file), 150)
    }
    setQuery('')
    setResults([])
    setOpen(false)
  }, [navigateTo, selectFile, currentPath])

  // Close on click outside
  const dropdownRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open && !showHistory) return
    const handler = (e: MouseEvent) => {
      if (inputRef.current?.contains(e.target as Node)) return
      if (dropdownRef.current?.contains(e.target as Node)) return
      setOpen(false)
      setShowHistory(false)
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [open, showHistory])

  // Get position for portal dropdown
  const rect = inputRef.current?.getBoundingClientRect()

  // What the chips offer, and what the list shows once one is chosen. Counting
  // happens on the whole result set, so a chip's number does not change as you
  // click between them.
  const counts = useMemo(() => {
    const m = new Map<FileType, number>()
    for (const f of results) m.set(f.type, (m.get(f.type) || 0) + 1)
    return m
  }, [results])
  const presentTypes = useMemo(() => typesInOrder(counts.keys()), [counts])
  const shown = useMemo(
    () => (typeFilter ? results.filter(f => f.type === typeFilter) : results),
    [results, typeFilter],
  )

  return (
    <>
      <div ref={inputRef}>
        <div className="flex items-center" style={{
          background: 'var(--th-bg-primary)', border: 'none', borderRadius: 8,
          padding: '0 12px', height: 32, gap: 10, minWidth: 180,
        }}>
          <span style={{ display: 'inline-flex', paddingRight: 8, flexShrink: 0 }}>
            <Search size={14} style={{ color: 'var(--th-text-muted)' }} />
          </span>
          <input
            value={query}
            onChange={e => handleChange(e.target.value)}
            onFocus={() => {
              if (results.length > 0) setOpen(true)
              else if (!query.trim() && searchHistory.length > 0) setShowHistory(true)
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search..."
            style={{
              border: 'none', background: 'transparent', color: 'var(--th-text-primary)',
              fontSize: 13, outline: 'none', width: '100%',
              padding: 0, margin: 0,
            }}
          />
        </div>
      </div>
      {open && results.length > 0 && rect && createPortal(
        <div ref={dropdownRef} style={{
          position: 'fixed',
          top: rect.bottom + 4,
          right: Math.max(window.innerWidth - rect.right, 10),
          width: Math.min(Math.max(rect.width + 200, 420), window.innerWidth - 20),
          background: 'var(--th-bg-secondary)', border: '1px solid var(--th-border)', borderRadius: 10,
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
          maxHeight: 480, overflowY: 'auto', zIndex: 9999,
        }}>
          {searching && (
            <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--th-text-muted)' }}>Searching...</div>
          )}
          {/* One chip per type present, in the same order the list is grouped in.
              Nothing to choose between when there is only one type. */}
          {presentTypes.length > 1 && (
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 5, padding: '8px 12px',
              borderBottom: '1px solid var(--th-border)', position: 'sticky', top: 0,
              background: 'var(--th-bg-secondary)', zIndex: 1,
            }}>
              {([null, ...presentTypes] as (FileType | null)[]).map(t => {
                const on = typeFilter === t
                const n = t === null ? results.length : counts.get(t) || 0
                return (
                  <button
                    key={t ?? 'all'}
                    onMouseDown={e => { e.preventDefault(); setTypeFilter(t) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '3px 8px', borderRadius: 999, cursor: 'pointer',
                      fontSize: 11, fontWeight: on ? 600 : 500,
                      border: `1px solid ${on ? 'var(--th-accent)' : 'var(--th-border)'}`,
                      background: on ? 'var(--th-accent-subtle)' : 'transparent',
                      color: on ? 'var(--th-accent)' : 'var(--th-text-secondary)',
                    }}
                  >
                    {t && <FileTypeIcon type={t} size={11} />}
                    {t === null ? 'Όλα' : getFileTypeLabel(t)}
                    <span style={{ opacity: 0.6 }}>{n}</span>
                  </button>
                )
              })}
            </div>
          )}
          {shown.map(f => {
            // Short parent path for context
            const parentPath = (f._dir || f.path.replace(/[/\\][^/\\]+$/, '')).replace(/^C:\\Users\\[^\\]+\\/, '~\\')
            return (
              <div
                key={f.path}
                onMouseDown={() => handleSelect(f)}
                style={{
                  padding: '10px 14px', cursor: 'pointer',
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                    <FileTypeIcon type={f.type} size={16} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'var(--th-text-primary)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {f.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--th-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {parentPath}
                    </div>
                  </div>
                  {f.size > 0 && (
                    <span style={{ fontSize: 11, color: 'var(--th-text-muted)', flexShrink: 0 }}>
                      {f.size < 1024 * 1024 ? Math.round(f.size / 1024) + 'K' : (f.size / (1024 * 1024)).toFixed(1) + 'M'}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
          <div style={{ padding: '6px 14px', fontSize: 11, color: 'var(--th-text-muted)', borderTop: '1px solid var(--th-border)', textAlign: 'right' }}>
            {typeFilter ? `${shown.length} από ${results.length}` : results.length} σε αυτόν τον φάκελο
          </div>
        </div>,
        document.body
      )}
      {showHistory && !open && searchHistory.length > 0 && rect && createPortal(
        <div ref={dropdownRef} style={{
          position: 'fixed',
          top: rect.bottom + 4,
          right: Math.max(window.innerWidth - rect.right, 10),
          width: Math.min(Math.max(rect.width + 100, 320), window.innerWidth - 20),
          background: 'var(--th-bg-secondary)', border: '1px solid var(--th-border)', borderRadius: 10,
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
          maxHeight: 400, overflowY: 'auto', zIndex: 9999,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: '1px solid var(--th-border)' }}>
            <span style={{ fontSize: 12, color: 'var(--th-text-muted)', fontWeight: 500 }}>Recent searches</span>
            <button
              onMouseDown={(e) => {
                e.preventDefault()
                window.api.settings.clearSearchHistory().then(() => {
                  setSearchHistory([])
                  setShowHistory(false)
                }).catch(() => {})
              }}
              style={{ background: 'none', border: 'none', color: 'var(--th-text-muted)', cursor: 'pointer', fontSize: 11, padding: '2px 6px', borderRadius: 4 }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--th-text-primary)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--th-text-muted)')}
            >Clear</button>
          </div>
          {searchHistory.slice(0, 15).map(h => {
            const d = new Date(h.time)
            const dateStr = d.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit' })
            const timeStr = d.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' })
            return (
              <div
                key={h.query + h.time}
                onMouseDown={() => {
                  setQuery(h.query)
                  queryRef.current = h.query
                  setShowHistory(false)
                  doSearch(h.query)
                }}
                style={{
                  padding: '8px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <Clock size={13} style={{ color: 'var(--th-text-muted)', flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: 'var(--th-text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {h.query}
                </span>
                <span style={{ fontSize: 11, color: 'var(--th-text-muted)', flexShrink: 0 }}>
                  {dateStr} {timeStr}
                </span>
              </div>
            )
          })}
        </div>,
        document.body
      )}
    </>
  )
}
