import { useState, useEffect, useRef, useCallback } from 'react'
import {
  ExternalLink, FolderOpen, Eye, Columns, Rows, Calculator,
  RectangleHorizontal, Pencil
} from 'lucide-react'
import { useAppStore } from '@/stores/app-store'
import { FileBrowser } from '../browser/FileBrowser'
import { PdfPreview } from './PdfPreview'
import { ImagePreview } from './ImagePreview'
import { BleedOverlay } from './BleedOverlay'
import { CostingDialog } from '../presscal/CostingDialog'
import { AnnotationOverlay } from '../tools/AnnotationOverlay'

export function PreviewPanel() {
  const { selectedFile, previewOpen } = useAppStore()
  const [layout, setLayout] = useState<'side' | 'bottom'>('side')
  const [previewSize, setPreviewSize] = useState(50) // percentage
  const resizingRef = useRef<boolean>(false)
  const [showBleed, setShowBleed] = useState(false)
  const [showAnnotations, setShowAnnotations] = useState(false)

  const hasPreview = previewOpen && selectedFile && !selectedFile.isDirectory

  const containerRef = useRef<HTMLDivElement>(null)
  const [isResizing, setIsResizing] = useState(false)

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const container = containerRef.current
    if (!container) return

    setIsResizing(true)
    resizingRef.current = true
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
      resizingRef.current = false
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
        <div className="flex flex-col overflow-hidden" style={{ flex: `0 0 ${previewSize}%`, minWidth: 360 }}>
          <PreviewToolbar layout={layout} onToggleLayout={() => setLayout('bottom')} showBleed={showBleed} onToggleBleed={() => setShowBleed(!showBleed)} showAnnotations={showAnnotations} onToggleAnnotations={() => setShowAnnotations(!showAnnotations)} />
          <div className="flex-1 overflow-hidden">
            <PreviewContent showBleed={showBleed} showAnnotations={showAnnotations} />
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
        <PreviewToolbar layout={layout} onToggleLayout={() => setLayout('side')} showBleed={showBleed} onToggleBleed={() => setShowBleed(!showBleed)} showAnnotations={showAnnotations} onToggleAnnotations={() => setShowAnnotations(!showAnnotations)} />
        <div className="flex-1 overflow-hidden">
          <PreviewContent showBleed={showBleed} showAnnotations={showAnnotations} />
        </div>
      </div>
    </div>
  )
}

function PreviewToolbar({ layout, onToggleLayout, showBleed, onToggleBleed, showAnnotations, onToggleAnnotations }: {
  layout: 'side' | 'bottom'; onToggleLayout: () => void
  showBleed: boolean; onToggleBleed: () => void
  showAnnotations: boolean; onToggleAnnotations: () => void
}) {
  const { selectedFile, presscalConnected, metadata } = useAppStore()
  const [showCosting, setShowCosting] = useState(false)

  const isPdf = selectedFile && ['.pdf', '.ai'].includes(selectedFile.extension?.toLowerCase() || '')
  const hasTrimBox = metadata?.trimBox != null

  return (
    <>
      {/* Row 1: filename */}
      <div className="flex items-center bg-bg-secondary border-b border-border flex-shrink-0" style={{ height: 32, padding: '0 12px' }}>
        <div className="flex items-center min-w-0" style={{ gap: 6, fontSize: 12, color: '#94a3b8' }}>
          <Eye size={13} style={{ color: '#64748b', flexShrink: 0 }} />
          <span className="truncate">{selectedFile?.name}</span>
        </div>
      </div>

      {/* Row 2: action buttons */}
      <div className="flex items-center bg-bg-secondary border-b border-border flex-shrink-0" style={{ height: 34, padding: '0 8px', gap: 2, overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none' }}>
        {/* Bleed overlay toggle — only for PDFs with TrimBox */}
        {isPdf && hasTrimBox && (
          <button
            onClick={onToggleBleed}
            title="Trim / Bleed / Safe"
            className="flex items-center rounded"
            style={{
              gap: 4, padding: '3px 8px', fontSize: 11, border: 'none', cursor: 'pointer', borderRadius: 4, flexShrink: 0,
              background: showBleed ? 'rgba(239,68,68,0.15)' : 'transparent',
              color: showBleed ? '#ef4444' : '#64748b',
            }}
          >
            <RectangleHorizontal size={13} />
            Bleed
          </button>
        )}

        {/* Annotation toggle */}
        <button
          onClick={onToggleAnnotations}
          title="Markup"
          className="flex items-center rounded"
          style={{
            gap: 4, padding: '3px 8px', fontSize: 11, border: 'none', cursor: 'pointer', borderRadius: 4, flexShrink: 0,
            background: showAnnotations ? 'rgba(245,130,32,0.15)' : 'transparent',
            color: showAnnotations ? '#f58220' : '#64748b',
          }}
        >
          <Pencil size={13} />
          Markup
        </button>

        {/* Layout toggle */}
        <button
          onClick={onToggleLayout}
          title={layout === 'side' ? 'Preview bottom' : 'Preview side'}
          style={{
            padding: '3px 6px', border: 'none', background: 'transparent',
            color: '#64748b', cursor: 'pointer', borderRadius: 4, flexShrink: 0,
          }}
        >
          {layout === 'side' ? <Rows size={14} /> : <Columns size={14} />}
        </button>

        <div style={{ flex: 1 }} />

        {/* Costing — only when PressCal connected */}
        {presscalConnected && selectedFile && (
          <button
            className="flex items-center rounded"
            style={{ gap: 5, padding: '3px 10px', fontSize: 11, color: '#f58220', border: '1px solid rgba(245,130,32,0.3)', background: 'rgba(245,130,32,0.06)', flexShrink: 0 }}
            onClick={() => setShowCosting(true)}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(245,130,32,0.15)'; e.currentTarget.style.borderColor = '#f58220' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(245,130,32,0.06)'; e.currentTarget.style.borderColor = 'rgba(245,130,32,0.3)' }}
          >
            <Calculator size={13} />
            <span>Κοστολόγηση</span>
          </button>
        )}

        {/* Open in app */}
        <button
          className="flex items-center rounded hover:bg-bg-hover"
          style={{ gap: 4, padding: '3px 8px', fontSize: 11, color: '#94a3b8', border: '1px solid var(--th-border, #1e293b)', flexShrink: 0, whiteSpace: 'nowrap' }}
          onClick={() => selectedFile && window.api.shell.openPath(selectedFile.path)}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#f58220'; e.currentTarget.style.color = '#f58220' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--th-border, #1e293b)'; e.currentTarget.style.color = '#94a3b8' }}
        >
          <ExternalLink size={12} />
          Open
        </button>

        {/* Show in folder */}
        <button
          className="flex items-center rounded hover:bg-bg-hover"
          style={{ gap: 4, padding: '3px 8px', fontSize: 11, color: '#94a3b8', border: '1px solid var(--th-border, #1e293b)', flexShrink: 0, whiteSpace: 'nowrap' }}
          onClick={() => selectedFile && window.api.shell.showInFolder(selectedFile.path)}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#f58220'; e.currentTarget.style.color = '#f58220' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--th-border, #1e293b)'; e.currentTarget.style.color = '#94a3b8' }}
        >
          <FolderOpen size={12} />
          Folder
        </button>
      </div>

      {showCosting && selectedFile && (
        <CostingDialog
          filePath={selectedFile.path}
          fileName={selectedFile.name}
          onClose={() => setShowCosting(false)}
        />
      )}
    </>
  )
}

function PreviewContent({ showBleed, showAnnotations }: { showBleed?: boolean; showAnnotations?: boolean }) {
  const { preview, previewLoading, selectedFile, metadata } = useAppStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry) {
        setContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height })
      }
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  if (previewLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-bg-primary">
        <div className="flex flex-col items-center gap-2 text-text-muted">
          <div style={{ width: 24, height: 24, borderTopColor: '#f58220', borderRadius: '50%' }} className="animate-spin border-2 border-border" />
          <span style={{ fontSize: 12 }}>Loading...</span>
        </div>
      </div>
    )
  }

  if (!preview || preview.type === 'none') {
    return (
      <div className="h-full flex items-center justify-center bg-bg-primary">
        <div className="flex flex-col items-center gap-2 text-text-muted">
          <Eye size={28} style={{ opacity: 0.3 }} />
          <span style={{ fontSize: 12 }}>No preview available</span>
          {selectedFile && (
            <button
              className="border border-border text-text-secondary hover:border-accent hover:text-accent"
              onClick={() => window.api.shell.openPath(selectedFile.path)}
              style={{
                marginTop: 8, padding: '6px 16px', borderRadius: 6,
                background: 'transparent', fontSize: 12, cursor: 'pointer',
              }}
            >
              Open in native app
            </button>
          )}
        </div>
      </div>
    )
  }

  // Estimate canvas size for overlays (based on container and aspect ratio)
  const canvasW = containerSize.w || 600
  const canvasH = containerSize.h || 400

  if (preview.type === 'pdf-page') {
    return (
      <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
        <PdfPreview data={preview.data} />
        {showBleed && metadata && (
          <BleedOverlay
            metadata={metadata}
            containerWidth={canvasW}
            containerHeight={canvasH}
            canvasWidth={canvasW}
            canvasHeight={canvasH}
            visible={showBleed}
          />
        )}
        {showAnnotations && (
          <AnnotationOverlay previewWidth={canvasW} previewHeight={canvasH} />
        )}
      </div>
    )
  }

  if (preview.type === 'image') {
    return (
      <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
        <ImagePreview data={preview.data} layers={preview.layers} />
        {showAnnotations && (
          <AnnotationOverlay previewWidth={canvasW} previewHeight={canvasH} />
        )}
      </div>
    )
  }

  if (preview.type === 'svg') {
    return (
      <div ref={containerRef} className="w-full h-full flex items-center justify-center overflow-hidden bg-bg-primary"
        style={{ padding: 16, position: 'relative' }}
      >
        <div dangerouslySetInnerHTML={{ __html: preview.data }} />
        {showAnnotations && (
          <AnnotationOverlay previewWidth={canvasW} previewHeight={canvasH} />
        )}
      </div>
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
    let blobUrl: string | null = null

    window.api.fs.readFile(selectedFile.path).then((buffer: any) => {
      if (cancelled) return
      const blob = new Blob([buffer])
      blobUrl = URL.createObjectURL(blob)
      const familyName = `preview-${Date.now()}`
      const face = new FontFace(familyName, `url(${blobUrl})`)
      face.load().then(loaded => {
        if (cancelled) return
        ;(document.fonts as any).add(loaded)
        setFontFace(familyName)
      }).catch(() => {})
    }).catch(() => {})

    return () => {
      cancelled = true
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
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
