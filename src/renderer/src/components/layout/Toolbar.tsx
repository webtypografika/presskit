import {
  ArrowLeft, ArrowRight, ArrowUp, RefreshCw,
  LayoutGrid, List, Scan,
  HardDrive, Cloud, Layers, RefreshCcw, Search, Send,
  PanelLeft, PanelRight, Eye, EyeOff,
  Columns, Pencil, Package, RectangleHorizontal,
  FolderPlus
} from 'lucide-react'
import { useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '@/stores/app-store'
import { Breadcrumb } from '../browser/Breadcrumb'
import { BatchPreflightPanel } from '../batch/BatchPreflightPanel'
import { ConvertDialog } from '../convert/ConvertDialog'
import { CompareView } from '../tools/CompareView'
import { FilePackager } from '../tools/FilePackager'

export type OverlayMode = 'none' | 'batch' | 'convert'

export function Toolbar() {
  const {
    navigateBack, navigateForward, navigateUp, refreshDirectory,
    viewMode, setViewMode, source, setSource, runPreflight,
    selectedFile, selectedFiles, pathHistory, historyIndex,
    showSidebar, setShowSidebar, showInspector, setShowInspector,
    previewOpen, togglePreview,
    thumbnailSize, setThumbnailSize,
    requestNewFolder
  } = useAppStore()

  const [overlay, setOverlay] = useState<OverlayMode>('none')
  const [showSendEmail, setShowSendEmail] = useState(false)
  const [showCompare, setShowCompare] = useState(false)
  const [showPackager, setShowPackager] = useState(false)

  // Files to send = multi-selected or single selected
  const filesToSend = selectedFiles.length > 0
    ? selectedFiles.filter(f => !f.isDirectory)
    : (selectedFile && !selectedFile.isDirectory ? [selectedFile] : [])

  const canGoBack = historyIndex > 0
  const canGoForward = historyIndex < pathHistory.length - 1
  const canPreflight = selectedFile && !selectedFile.isDirectory

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
          <ToolbarButton icon={<FolderPlus size={18} />} onClick={requestNewFolder} title="Νέος Φάκελος" />
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
          <LabeledButton icon={<Columns size={16} />} label="Compare" onClick={() => setShowCompare(true)} disabled={!canPreflight} />
          <LabeledButton icon={<Package size={16} />} label="Collect" onClick={() => setShowPackager(true)} />
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
                background: 'rgba(245,130,32,0.1)', color: '#f58220', border: '1px solid rgba(245,130,32,0.3)',
                cursor: 'pointer',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(245,130,32,0.2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(245,130,32,0.1)')}
            >
              <Send size={14} />
              Αποστολή {filesToSend.length > 1 ? `(${filesToSend.length})` : ''}
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
              style={{ width: 80, marginLeft: 6, accentColor: '#f58220', cursor: 'pointer' }}
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
              background: source === 'local' ? '#1e2a4a' : 'transparent',
              color: source === 'local' ? '#f58220' : '#94a3b8',
            }}
            onClick={() => setSource('local')}
          >
            <HardDrive size={13} /> Local
          </button>
          <button
            className="flex items-center rounded transition-colors"
            style={{
              gap: 4, padding: '2px 10px', fontSize: 12, minHeight: 'auto',
              background: source === 'dropbox' ? '#1e2a4a' : 'transparent',
              color: source === 'dropbox' ? '#f58220' : '#94a3b8',
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
        <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 50, display: 'flex' }}
          onClick={(e) => { if (e.target === e.currentTarget) setOverlay('none') }}
        >
          <div style={{ marginLeft: 'auto', width: 360, height: '100%', borderLeft: '1px solid var(--th-border)', background: 'var(--th-bg-secondary)', boxShadow: '-4px 0 20px rgba(0,0,0,0.15)' }}>
            <ConvertDialog onClose={() => setOverlay('none')} />
          </div>
        </div>,
        document.body
      )}

      {showSendEmail && <SendEmailDialog files={filesToSend} onClose={() => setShowSendEmail(false)} />}
      {showCompare && <CompareView onClose={() => setShowCompare(false)} />}
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
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
        <div onClick={e => e.stopPropagation()} style={{ width: 400, background: 'var(--th-bg-secondary)', borderRadius: 14, border: '1px solid var(--th-border)', padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: 'var(--th-text-muted)', marginBottom: 16 }}>Συνδεθείτε πρώτα στο PressCal (Settings → PressCal)</div>
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
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: 500, maxHeight: '80vh', display: 'flex', flexDirection: 'column', background: 'var(--th-bg-secondary)', borderRadius: 14, border: '1px solid var(--th-border)', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--th-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Send size={18} style={{ color: '#f58220' }} />
          <span style={{ fontSize: 16, fontWeight: 600, flex: 1, color: 'var(--th-text-primary)' }}>Αποστολή Email</span>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: 'var(--th-text-muted)', cursor: 'pointer', fontSize: 18 }}>&times;</button>
        </div>

        {/* Attachments */}
        <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--th-border)', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
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
          <span style={{ fontSize: 11, color: 'var(--th-text-muted)', alignSelf: 'center', marginLeft: 4 }}>
            {files.length} αρχεί{files.length === 1 ? 'ο' : 'α'} · {formatSize(totalSize)}
          </span>
        </div>

        {/* Form */}
        <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12, flex: 1, overflow: 'auto' }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--th-text-muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Προς</label>
            <input value={to} onChange={e => setTo(e.target.value)} placeholder="email@example.com" type="email" style={inp} autoFocus />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--th-text-muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Θέμα</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Αρχεία για έγκριση" style={inp} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--th-text-muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>Μήνυμα</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Σας αποστέλλουμε τα αρχεία..." rows={4} style={{ ...inp, resize: 'vertical' }} />
          </div>

          {error && <div style={{ fontSize: 13, color: '#ef4444' }}>{error}</div>}
        </div>

        {/* Actions */}
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--th-border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid var(--th-border)', background: 'transparent', color: 'var(--th-text-muted)', fontSize: 14, cursor: 'pointer' }}>
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
    setSearching(true)
    try {
      // Use indexed search (fast, fuzzy)
      const r = await window.api.search.query(q.trim(), 20)
      // Map DB results to FileEntry-like objects
      const mapped = (r || []).map((item: any) => ({
        name: item.name,
        path: item.path,
        isDirectory: item.is_dir === 1,
        size: item.size || 0,
        modified: item.modified ? new Date(item.modified).toISOString() : '',
        extension: item.ext || '',
        type: item.is_dir === 1 ? 'folder' : 'unknown',
        _dir: item.dir, // parent directory for display
      }))
      setResults(mapped)
      setOpen(true)
    } catch (e) {
      console.error('[SEARCH] error:', e)
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  const handleChange = useCallback((val: string) => {
    setQuery(val)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSearch(val), 150)
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
          background: 'var(--th-bg-primary)', border: 'none', borderRadius: 8,
          padding: '0 12px', height: 32, gap: 10, minWidth: 180,
        }}>
          <span style={{ display: 'inline-flex', paddingRight: 8, flexShrink: 0 }}>
            <Search size={14} style={{ color: 'var(--th-text-muted)' }} />
          </span>
          <input
            value={query}
            onChange={e => handleChange(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 300)}
            placeholder="Αναζήτηση..."
            style={{
              border: 'none', background: 'transparent', color: 'var(--th-text-primary)',
              fontSize: 13, outline: 'none', width: '100%',
              padding: 0, margin: 0,
            }}
          />
        </div>
      </div>
      {open && results.length > 0 && rect && createPortal(
        <div style={{
          position: 'fixed',
          top: rect.bottom + 4,
          right: Math.max(window.innerWidth - rect.right, 10),
          width: Math.min(Math.max(rect.width + 200, 420), window.innerWidth - 20),
          background: 'var(--th-bg-secondary)', border: '1px solid var(--th-border)', borderRadius: 10,
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
          maxHeight: 360, overflowY: 'auto', zIndex: 9999,
        }}>
          {searching && (
            <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--th-text-muted)' }}>Αναζήτηση...</div>
          )}
          {results.map(f => {
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
                  <span style={{ fontSize: 14, flexShrink: 0 }}>
                    {f.isDirectory ? '📁' : f.extension === '.pdf' ? '📕' : f.extension?.match(/\.(jpg|png|tif|psd|ai|svg)/) ? '🖼️' : '📄'}
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
        </div>,
        document.body
      )}
    </>
  )
}
