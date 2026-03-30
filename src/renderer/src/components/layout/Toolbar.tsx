import {
  ArrowLeft, ArrowRight, ArrowUp, RefreshCw,
  LayoutGrid, List, Scan, Settings,
  HardDrive, Cloud, Layers, RefreshCcw, Search, Send
} from 'lucide-react'
import { useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '@/stores/app-store'
import { Breadcrumb } from '../browser/Breadcrumb'
import { SettingsDialog } from '../tools/SettingsDialog'
import { BatchPreflightPanel } from '../batch/BatchPreflightPanel'
import { ConvertDialog } from '../convert/ConvertDialog'

export type OverlayMode = 'none' | 'batch' | 'convert'

export function Toolbar() {
  const {
    navigateBack, navigateForward, navigateUp, refreshDirectory,
    viewMode, setViewMode, source, setSource, runPreflight,
    selectedFile, selectedFiles, pathHistory, historyIndex
  } = useAppStore()

  const [showSettings, setShowSettings] = useState(false)
  const [overlay, setOverlay] = useState<OverlayMode>('none')
  const [showSendEmail, setShowSendEmail] = useState(false)

  // Files to send = multi-selected or single selected
  const filesToSend = selectedFiles.length > 0
    ? selectedFiles.filter(f => !f.isDirectory)
    : (selectedFile && !selectedFile.isDirectory ? [selectedFile] : [])

  const canGoBack = historyIndex > 0
  const canGoForward = historyIndex < pathHistory.length - 1
  const canPreflight = selectedFile && !selectedFile.isDirectory

  return (
    <>
      <div className="titlebar-no-drag flex items-center bg-bg-secondary border-b border-border flex-shrink-0" style={{ height: 56, gap: 12, padding: '0 24px' }}>
        {/* Navigation */}
        <div className="flex items-center gap-1.5">
          <ToolbarButton icon={<ArrowLeft size={18} />} onClick={navigateBack} disabled={!canGoBack} title="Back" />
          <ToolbarButton icon={<ArrowRight size={18} />} onClick={navigateForward} disabled={!canGoForward} title="Forward" />
          <ToolbarButton icon={<ArrowUp size={18} />} onClick={navigateUp} title="Up" />
          <ToolbarButton icon={<RefreshCw size={18} />} onClick={refreshDirectory} title="Refresh" />
        </div>

        <div className="w-px h-5 bg-border" style={{ margin: '0 8px' }} />

        {/* Source toggle */}
        <div className="flex items-center bg-bg-primary rounded-lg" style={{ padding: 2 }}>
          <button
            className="flex items-center rounded-lg text-sm transition-colors"
            style={{
              gap: 6, padding: '6px 14px',
              background: source === 'local' ? '#1e2a4a' : 'transparent',
              color: source === 'local' ? '#f58220' : '#94a3b8',
            }}
            onClick={() => setSource('local')}
          >
            <HardDrive size={15} /> Local
          </button>
          <button
            className="flex items-center rounded-lg text-sm transition-colors"
            style={{
              gap: 6, padding: '6px 14px',
              background: source === 'dropbox' ? '#1e2a4a' : 'transparent',
              color: source === 'dropbox' ? '#f58220' : '#94a3b8',
            }}
            onClick={() => setSource('dropbox')}
          >
            <Cloud size={15} /> Dropbox
          </button>
        </div>

        <div className="w-px h-5 bg-border" style={{ margin: '0 8px' }} />

        {/* Breadcrumb */}
        <div className="flex-1 min-w-0">
          <Breadcrumb />
        </div>

        <div className="w-px h-5 bg-border" style={{ margin: '0 8px' }} />

        {/* Search */}
        <SearchBox />

        <div className="w-px h-5 bg-border" style={{ margin: '0 8px' }} />

        {/* Actions */}
        <ToolbarButton
          icon={<Scan size={18} />}
          onClick={runPreflight}
          disabled={!canPreflight}
          title="Preflight"
          accent
        />
        <ToolbarButton
          icon={<Layers size={18} />}
          onClick={() => setOverlay(overlay === 'batch' ? 'none' : 'batch')}
          active={overlay === 'batch'}
          title="Batch Preflight"
        />
        <ToolbarButton
          icon={<RefreshCcw size={18} />}
          onClick={() => setOverlay(overlay === 'convert' ? 'none' : 'convert')}
          active={overlay === 'convert'}
          disabled={!canPreflight}
          title="Convert File"
        />

        {/* Send email */}
        {filesToSend.length > 0 && (
          <button
            onClick={() => setShowSendEmail(true)}
            className="flex items-center rounded-lg transition-colors"
            style={{
              gap: 6, padding: '6px 14px', fontSize: 13, fontWeight: 600,
              background: 'rgba(245,130,32,0.1)', color: '#f58220', border: '1px solid rgba(245,130,32,0.3)',
              cursor: 'pointer',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(245,130,32,0.2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(245,130,32,0.1)')}
          >
            <Send size={14} />
            Αποστολή {filesToSend.length > 1 ? `(${filesToSend.length})` : ''}
          </button>
        )}

        <div className="w-px h-5 bg-border" style={{ margin: '0 8px' }} />

        {/* View mode */}
        <div className="flex items-center gap-0.5">
          <ToolbarButton icon={<LayoutGrid size={18} />} onClick={() => setViewMode('grid')} active={viewMode === 'grid'} title="Grid" />
          <ToolbarButton icon={<List size={18} />} onClick={() => setViewMode('list')} active={viewMode === 'list'} title="List" />
        </div>

        <ToolbarButton icon={<Settings size={18} />} onClick={() => setShowSettings(true)} title="Settings" />
      </div>

      {/* Overlay panels */}
      {overlay === 'batch' && (
        <div className="absolute inset-x-0 top-[76px] bottom-6 z-40">
          <BatchPreflightPanel onClose={() => setOverlay('none')} />
        </div>
      )}
      {overlay === 'convert' && (
        <div className="absolute right-0 top-[76px] bottom-6 w-[360px] z-40 border-l border-border">
          <ConvertDialog onClose={() => setOverlay('none')} />
        </div>
      )}

      {/* Settings dialog */}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {showSendEmail && <SendEmailDialog files={filesToSend} onClose={() => setShowSendEmail(false)} />}
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
      className={`p-2.5 rounded-lg transition-colors ${
        disabled
          ? 'text-text-muted cursor-not-allowed'
          : active
            ? 'text-accent bg-bg-active'
            : accent
              ? 'text-accent hover:bg-bg-hover'
              : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
      }`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {icon}
    </button>
  )
}

function SendEmailDialog({ files, onClose }: { files: any[]; onClose: () => void }) {
  const { presscalConnected, lastCustomerEmail } = useAppStore()
  const [to, setTo] = useState(lastCustomerEmail || '')
  const [subject, setSubject] = useState('Αρχεία για έγκριση')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const totalSize = files.reduce((s, f) => s + (f.size || 0), 0)

  const handleSend = async () => {
    if (!to.trim() || !subject.trim()) return
    setSending(true)
    setError('')

    try {
      // Send files via presscal — pass file paths, main process handles base64
      await window.api.presscal.sendEmailWithFiles({
        to: to.trim(),
        subject: subject.trim(),
        body: body.trim(),
        filePaths: files.map((f: any) => ({ path: f.path, name: f.name, ext: f.extension }))
      })

      setSent(true)
      setTimeout(onClose, 1500)
    } catch (e: any) {
      setError(e.message || 'Αποτυχία αποστολής')
    } finally {
      setSending(false)
    }
  }

  if (!presscalConnected) {
    return createPortal(
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
        <div onClick={e => e.stopPropagation()} style={{ width: 400, background: '#141e37', borderRadius: 14, border: '1px solid #1e293b', padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: '#94a3b8', marginBottom: 16 }}>Συνδεθείτε πρώτα στο PressCal (Settings → PressCal)</div>
          <button onClick={onClose} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid #1e293b', background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}>OK</button>
        </div>
      </div>,
      document.body
    )
  }

  const inp: React.CSSProperties = {
    width: '100%', padding: '10px 14px', borderRadius: 8,
    background: '#0a0e1a', border: '1px solid #1e293b', color: '#e2e8f0',
    fontSize: 14, outline: 'none',
  }

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: 500, maxHeight: '80vh', display: 'flex', flexDirection: 'column', background: '#141e37', borderRadius: 14, border: '1px solid #1e293b', boxShadow: '0 20px 60px rgba(0,0,0,0.5)', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '18px 24px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Send size={18} style={{ color: '#f58220' }} />
          <span style={{ fontSize: 16, fontWeight: 600, flex: 1 }}>Αποστολή Email</span>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: 18 }}>&times;</button>
        </div>

        {/* Attachments */}
        <div style={{ padding: '12px 24px', borderBottom: '1px solid #1e293b', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {files.map((f, i) => (
            <span key={i} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 6,
              background: 'rgba(245,130,32,0.08)', border: '1px solid rgba(245,130,32,0.2)',
              fontSize: 12, color: '#f58220',
            }}>
              📎 {f.name}
            </span>
          ))}
          <span style={{ fontSize: 11, color: '#64748b', alignSelf: 'center', marginLeft: 4 }}>
            {files.length} αρχεί{files.length === 1 ? 'ο' : 'α'} · {formatSize(totalSize)}
          </span>
        </div>

        {/* Form */}
        <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12, flex: 1, overflow: 'auto' }}>
          <div>
            <label style={{ fontSize: 12, color: '#64748b', fontWeight: 600, display: 'block', marginBottom: 4 }}>Προς</label>
            <input value={to} onChange={e => setTo(e.target.value)} placeholder="email@example.com" type="email" style={inp} autoFocus />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#64748b', fontWeight: 600, display: 'block', marginBottom: 4 }}>Θέμα</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Αρχεία για έγκριση" style={inp} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#64748b', fontWeight: 600, display: 'block', marginBottom: 4 }}>Μήνυμα</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Σας αποστέλλουμε τα αρχεία..." rows={4} style={{ ...inp, resize: 'vertical' }} />
          </div>

          {error && <div style={{ fontSize: 13, color: '#ef4444' }}>{error}</div>}
        </div>

        {/* Actions */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid #1e293b', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #1e293b', background: 'transparent', color: '#94a3b8', fontSize: 14, cursor: 'pointer' }}>
            Ακύρωση
          </button>
          <button
            onClick={handleSend}
            disabled={sending || sent || !to.trim() || !subject.trim()}
            style={{
              padding: '10px 24px', borderRadius: 8, border: 'none',
              background: sent ? '#22c55e' : '#f58220', color: '#fff',
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
              opacity: (sending || !to.trim() || !subject.trim()) ? 0.5 : 1,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {sending ? 'Αποστολή...' : sent ? '✓ Εστάλη!' : <><Send size={14} /> Αποστολή</>}
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

function SearchBox() {
  const { selectFile, navigateTo, currentPath } = useAppStore()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<any>(null)

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      return
    }
    let searchPath = currentPath
    if (!searchPath) {
      try {
        const paths = await window.api.system.userPaths()
        searchPath = paths.home
      } catch {
        searchPath = 'C:\\'
      }
    }
    setSearching(true)
    try {
      const r = await window.api.fs.search(searchPath, q.trim(), 20)
      setResults(r || [])
      setOpen(true)
    } catch (e) {
      console.error('[SEARCH] error:', e)
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [currentPath])

  const handleChange = useCallback((val: string) => {
    setQuery(val)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSearch(val), 300)
  }, [doSearch])

  const handleSelect = useCallback((file: any) => {
    if (file.isDirectory) {
      navigateTo(file.path)
    } else {
      selectFile(file)
    }
    setQuery('')
    setResults([])
    setOpen(false)
  }, [navigateTo, selectFile])

  // Get position for portal dropdown
  const rect = inputRef.current?.getBoundingClientRect()

  return (
    <>
      <div ref={inputRef}>
        <div className="flex items-center" style={{
          background: '#0a0e1a', border: '1px solid #1e293b', borderRadius: 8,
          padding: '0 10px', height: 32, gap: 6, minWidth: 180,
        }}>
          <Search size={14} style={{ color: '#64748b', flexShrink: 0 }} />
          <input
            value={query}
            onChange={e => handleChange(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 300)}
            placeholder="Αναζήτηση..."
            style={{
              border: 'none', background: 'transparent', color: '#e2e8f0',
              fontSize: 13, outline: 'none', width: '100%',
              padding: '0 !important', margin: 0,
            }}
          />
        </div>
      </div>
      {open && results.length > 0 && rect && createPortal(
        <div style={{
          position: 'fixed',
          top: rect.bottom + 4,
          left: rect.left,
          width: Math.max(rect.width, 280),
          background: '#141e37', border: '1px solid #1e293b', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          maxHeight: 280, overflowY: 'auto', zIndex: 9999,
        }}>
          {results.map(f => (
            <div
              key={f.path}
              onMouseDown={() => handleSelect(f)}
              style={{
                padding: '10px 14px', cursor: 'pointer', fontSize: 13, color: '#e2e8f0',
                borderBottom: '1px solid rgba(255,255,255,0.03)',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: f.isDirectory ? '#f58220' : '#64748b' }}>
                  {f.isDirectory ? '📁' : '📄'}
                </span>
                {f.name}
              </div>
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}
