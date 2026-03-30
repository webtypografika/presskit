import { useState, useEffect, useRef, useCallback } from 'react'
import {
  ExternalLink, FolderOpen, Eye, Columns, Rows
} from 'lucide-react'
import { useAppStore } from '@/stores/app-store'
import { FileBrowser } from '../browser/FileBrowser'
import { PdfPreview } from './PdfPreview'
import { ImagePreview } from './ImagePreview'

export function PreviewPanel() {
  const { selectedFile } = useAppStore()
  const [layout, setLayout] = useState<'side' | 'bottom'>('side')
  const [previewSize, setPreviewSize] = useState(50) // percentage
  const resizingRef = useRef<boolean>(false)

  const hasPreview = selectedFile && !selectedFile.isDirectory

  const containerRef = useRef<HTMLDivElement>(null)
  const [isResizing, setIsResizing] = useState(false)

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const container = containerRef.current
    if (!container) return

    setIsResizing(true)
    const containerRect = container.getBoundingClientRect()
    const totalSize = layout === 'side' ? containerRect.width : containerRect.height

    const onMouseMove = (ev: MouseEvent) => {
      ev.preventDefault()
      const currentPos = layout === 'side' ? ev.clientX : ev.clientY
      const offset = currentPos - (layout === 'side' ? containerRect.left : containerRect.top)
      const pct = Math.max(20, Math.min(80, (offset / totalSize) * 100))
      setPreviewSize(100 - pct)
    }

    const onMouseUp = () => {
      setIsResizing(false)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.body.style.cursor = layout === 'side' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
  }, [layout])

  // No file selected — full file browser
  if (!hasPreview) {
    return <FileBrowser />
  }

  // File selected — split: files + preview
  // Overlay prevents iframes from stealing mouse events during resize
  const resizeOverlay = isResizing ? (
    <div style={{ position: 'absolute', inset: 0, zIndex: 50, cursor: layout === 'side' ? 'col-resize' : 'row-resize' }} />
  ) : null

  if (layout === 'side') {
    return (
      <div className="h-full flex" ref={containerRef} style={{ position: 'relative' }}>
        {resizeOverlay}
        <div className="overflow-hidden" style={{ flex: `0 0 ${100 - previewSize}%`, minWidth: 200 }}>
          <FileBrowser />
        </div>
        <div
          onMouseDown={startResize}
          style={{
            width: 6, flexShrink: 0, cursor: 'col-resize',
            background: 'transparent', transition: 'background 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = '#f58220')}
          onMouseLeave={e => { if (!resizingRef.current) e.currentTarget.style.background = 'transparent' }}
        />
        <div className="flex flex-col overflow-hidden" style={{ flex: `0 0 ${previewSize}%`, minWidth: 200 }}>
          <PreviewToolbar layout={layout} onToggleLayout={() => setLayout('bottom')} />
          <div className="flex-1 overflow-hidden">
            <PreviewContent />
          </div>
        </div>
      </div>
    )
  }

  // Bottom layout
  return (
    <div className="h-full flex flex-col" ref={containerRef} style={{ position: 'relative' }}>
      {resizeOverlay}
      <div className="overflow-hidden" style={{ flex: `0 0 ${100 - previewSize}%`, minHeight: 100 }}>
        <FileBrowser />
      </div>
      <div
        style={{ height: 6, cursor: 'row-resize', background: 'transparent', flexShrink: 0, transition: 'background 0.15s' }}
        onMouseDown={startResize}
        onMouseEnter={e => (e.currentTarget.style.background = '#f58220')}
        onMouseLeave={e => { if (!resizingRef.current) e.currentTarget.style.background = 'transparent' }}
      />
      <div className="flex flex-col overflow-hidden" style={{ flex: `0 0 ${previewSize}%`, minHeight: 100 }}>
        <PreviewToolbar layout={layout} onToggleLayout={() => setLayout('side')} />
        <div className="flex-1 overflow-hidden">
          <PreviewContent />
        </div>
      </div>
    </div>
  )
}

function PreviewToolbar({ layout, onToggleLayout }: { layout: 'side' | 'bottom'; onToggleLayout: () => void }) {
  const { selectedFile } = useAppStore()

  return (
    <div className="flex items-center justify-between bg-bg-secondary border-b border-border flex-shrink-0" style={{ height: 40, padding: '0 16px' }}>
      <div className="flex items-center" style={{ gap: 8, fontSize: 13, color: '#94a3b8' }}>
        <Eye size={15} style={{ color: '#64748b' }} />
        <span className="truncate" style={{ maxWidth: 200 }}>{selectedFile?.name}</span>
      </div>

      <div className="flex items-center" style={{ gap: 4 }}>
        {/* Layout toggle */}
        <button
          onClick={onToggleLayout}
          title={layout === 'side' ? 'Preview bottom' : 'Preview side'}
          style={{
            padding: '4px 8px', border: 'none', background: 'transparent',
            color: '#64748b', cursor: 'pointer', borderRadius: 4,
          }}
        >
          {layout === 'side' ? <Rows size={15} /> : <Columns size={15} />}
        </button>

        {/* Open in app */}
        <button
          className="flex items-center rounded hover:bg-bg-hover"
          style={{ gap: 5, padding: '4px 10px', fontSize: 12, color: '#94a3b8', border: '1px solid #1e293b' }}
          onClick={() => selectedFile && window.api.shell.openPath(selectedFile.path)}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#f58220'; e.currentTarget.style.color = '#f58220' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#1e293b'; e.currentTarget.style.color = '#94a3b8' }}
        >
          <ExternalLink size={13} />
          <span>Open</span>
        </button>

        {/* Show in folder */}
        <button
          className="flex items-center rounded hover:bg-bg-hover"
          style={{ gap: 5, padding: '4px 10px', fontSize: 12, color: '#94a3b8', border: '1px solid #1e293b' }}
          onClick={() => selectedFile && window.api.shell.showInFolder(selectedFile.path)}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#f58220'; e.currentTarget.style.color = '#f58220' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#1e293b'; e.currentTarget.style.color = '#94a3b8' }}
        >
          <FolderOpen size={13} />
          <span>Folder</span>
        </button>
      </div>
    </div>
  )
}

function PreviewContent() {
  const { preview, previewLoading, selectedFile, metadata } = useAppStore()

  if (previewLoading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: '#0a0e1a' }}>
        <div className="flex flex-col items-center gap-2" style={{ color: '#64748b' }}>
          <div style={{ width: 24, height: 24, border: '2px solid #1e293b', borderTopColor: '#f58220', borderRadius: '50%' }} className="animate-spin" />
          <span style={{ fontSize: 12 }}>Loading...</span>
        </div>
      </div>
    )
  }

  if (!preview || preview.type === 'none') {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: '#0a0e1a' }}>
        <div className="flex flex-col items-center gap-2" style={{ color: '#64748b' }}>
          <Eye size={28} style={{ opacity: 0.3 }} />
          <span style={{ fontSize: 12 }}>No preview available</span>
          {selectedFile && (
            <button
              onClick={() => window.api.shell.openPath(selectedFile.path)}
              style={{
                marginTop: 8, padding: '6px 16px', borderRadius: 6,
                border: '1px solid #1e293b', background: 'transparent',
                color: '#94a3b8', fontSize: 12, cursor: 'pointer',
              }}
            >
              Open in native app
            </button>
          )}
        </div>
      </div>
    )
  }

  if (preview.type === 'pdf-page') {
    return <PdfPreview data={preview.data} />
  }

  if (preview.type === 'image') {
    return <ImagePreview data={preview.data} layers={preview.layers} />
  }

  if (preview.type === 'svg') {
    return (
      <div className="w-full h-full flex items-center justify-center overflow-auto"
        style={{ padding: 16, background: '#0a0e1a' }}
        dangerouslySetInnerHTML={{ __html: preview.data }}
      />
    )
  }

  if (preview.type === 'font-sample') {
    return <FontPreviewInline />
  }

  return null
}

function FontPreviewInline() {
  const { selectedFile, metadata } = useAppStore()
  const [fontFace, setFontFace] = useState<string | null>(null)
  const [sampleText, setSampleText] = useState('The quick brown fox jumps over the lazy dog')

  useEffect(() => {
    if (!selectedFile?.path) return
    let cancelled = false

    window.api.fs.readFile(selectedFile.path).then((buffer: any) => {
      if (cancelled) return
      const blob = new Blob([buffer])
      const url = URL.createObjectURL(blob)
      const familyName = `preview-${Date.now()}`
      const face = new FontFace(familyName, `url(${url})`)
      face.load().then(loaded => {
        if (cancelled) return
        ;(document.fonts as any).add(loaded)
        setFontFace(familyName)
      }).catch(() => {})
    }).catch(() => {})

    return () => { cancelled = true }
  }, [selectedFile?.path])

  return (
    <div className="h-full overflow-auto" style={{ padding: 20, background: '#0a0e1a' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>
        {metadata?.fontFamily || selectedFile?.name}
      </div>
      {metadata?.fontSubfamily && (
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>{metadata.fontSubfamily}</div>
      )}
      <input
        value={sampleText}
        onChange={e => setSampleText(e.target.value)}
        placeholder="Type to preview..."
        style={{
          width: '100%', padding: '8px 12px', borderRadius: 6,
          background: '#151c2e', border: '1px solid #1e293b', color: '#e2e8f0',
          fontSize: 14, fontFamily: fontFace || 'monospace', outline: 'none', marginBottom: 16,
        }}
      />
      {[16, 24, 36, 48].map(size => (
        <div key={size} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: '#475569', marginBottom: 4 }}>{size}px</div>
          <div style={{ fontSize: size, fontFamily: fontFace || 'monospace', color: '#e2e8f0', lineHeight: 1.3, wordBreak: 'break-word' }}>
            {sampleText || 'AaBbCcDd'}
          </div>
        </div>
      ))}
    </div>
  )
}
