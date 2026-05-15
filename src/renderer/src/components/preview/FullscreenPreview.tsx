import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '@/stores/app-store'
import { X, Loader2, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import { PdfPreview } from './PdfPreview'

export function FullscreenPreview() {
  const fullscreenPreview = useAppStore(s => s.fullscreenPreview)
  const selectedFile = useAppStore(s => s.selectedFile)
  const files = useAppStore(s => s.files)
  const selectFile = useAppStore(s => s.selectFile)
  const storePreview = useAppStore(s => s.preview)

  const [localPreview, setLocalPreview] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  // Zoom/pan state
  const [zoom, setZoom] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const posStartRef = useRef({ x: 0, y: 0 })
  const contentRef = useRef<HTMLDivElement>(null)

  // Get navigable files (non-directories)
  const fileList = files.filter(f => !f.isDirectory)
  const currentIndex = fileList.findIndex(f => f.path === selectedFile?.path)

  const goNext = useCallback(() => {
    if (currentIndex < fileList.length - 1) {
      selectFile(fileList[currentIndex + 1])
    }
  }, [currentIndex, fileList, selectFile])

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      selectFile(fileList[currentIndex - 1])
    }
  }, [currentIndex, fileList, selectFile])

  // Reset zoom on file change
  useEffect(() => {
    setZoom(1)
    setPosition({ x: 0, y: 0 })
  }, [selectedFile?.path])

  const isPdf = localPreview?.type === 'pdf-page'

  // Wheel zoom — native listener for non-passive (skip for PDFs — PdfPreview handles its own)
  useEffect(() => {
    const el = contentRef.current
    if (!el || !fullscreenPreview || isPdf) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      setZoom(z => Math.max(0.1, Math.min(10, z + delta)))
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [fullscreenPreview, isPdf])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    setDragging(true)
    dragStartRef.current = { x: e.clientX, y: e.clientY }
    posStartRef.current = { ...position }
  }, [position])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return
    setPosition({
      x: posStartRef.current.x + (e.clientX - dragStartRef.current.x),
      y: posStartRef.current.y + (e.clientY - dragStartRef.current.y)
    })
  }, [dragging])

  const handleMouseUp = useCallback(() => {
    setDragging(false)
  }, [])

  // Tell main process about fullscreen state so window X closes preview, not app
  useEffect(() => {
    window.api.window.setFullscreenPreview(fullscreenPreview)
    if (!fullscreenPreview) return
    const cleanup = window.api.window.onCloseFullscreenPreview(() => {
      useAppStore.setState({ fullscreenPreview: false })
    })
    return () => {
      window.api.window.setFullscreenPreview(false)
      cleanup()
    }
  }, [fullscreenPreview])

  // Keyboard nav
  useEffect(() => {
    if (!fullscreenPreview) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        goNext()
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        goPrev()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [fullscreenPreview, goNext, goPrev])

  // Load preview data when file changes
  useEffect(() => {
    if (!fullscreenPreview || !selectedFile || selectedFile.isDirectory) {
      setLocalPreview(null)
      return
    }

    if (storePreview) {
      setLocalPreview(storePreview)
      return
    }

    setLoading(true)
    window.api.preview.full(selectedFile.path)
      .then(p => setLocalPreview(p))
      .catch(() => setLocalPreview(null))
      .finally(() => setLoading(false))
  }, [fullscreenPreview, selectedFile, storePreview])

  if (!fullscreenPreview || !selectedFile) return null

  const close = () => useAppStore.setState({ fullscreenPreview: false })
  const preview = localPreview
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < fileList.length - 1

  const navBtnStyle: React.CSSProperties = {
    position: 'absolute', top: '50%', transform: 'translateY(-50%)',
    background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 12,
    padding: 12, cursor: 'pointer', color: '#fff', zIndex: 10,
    opacity: 0.6, transition: 'opacity 0.15s',
  }

  const zoomBtnStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 6,
    padding: '4px 6px', cursor: 'pointer', color: '#fff', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
  }

  // For images: render img directly (no ImagePreview which has its own zoom)
  // For PDFs: render PdfPreview inside zoom wrapper
  const renderContent = () => {
    if (loading) {
      return (
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Loader2 size={32} className="animate-spin" style={{ color: '#fff' }} />
        </div>
      )
    }
    if (!preview) {
      return (
        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>
          No preview available
        </div>
      )
    }
    if (preview.type === 'image') {
      return (
        <img
          src={preview.data}
          alt="Preview"
          draggable={false}
          style={{
            maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
            transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
            transition: dragging ? 'none' : 'transform 0.1s ease-out',
          }}
        />
      )
    }
    if (preview.type === 'pdf-page') {
      // PdfPreview has its own zoom/pan — no outer transform needed
      return (
        <div style={{ width: '100%', height: '100%' }}>
          <PdfPreview data={preview.data} fullscreen />
        </div>
      )
    }
    if (preview.type === 'svg') {
      return (
        <div
          style={{
            padding: 32,
            transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
            transition: dragging ? 'none' : 'transform 0.1s ease-out',
          }}
          dangerouslySetInnerHTML={{ __html: preview.data }}
        />
      )
    }
    return null
  }

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.92)',
        display: 'flex', flexDirection: 'column',
      }}
      onClick={close}
    >
      {/* Header with zoom controls */}
      <div
        style={{
          padding: '8px 20px', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
        onClick={e => e.stopPropagation()}
      >
        <span style={{ fontSize: 14, color: '#fff', opacity: 0.7 }}>
          {selectedFile.name}
          {fileList.length > 1 && (
            <span style={{ marginLeft: 10, fontSize: 12, opacity: 0.5 }}>
              {currentIndex + 1} / {fileList.length}
            </span>
          )}
        </span>

        {/* Zoom controls — hidden for PDFs (PdfPreview has its own) */}
        {preview && !loading && !isPdf && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              style={zoomBtnStyle}
              onClick={() => setZoom(z => Math.max(0.1, z - 0.25))}
              title="Zoom out"
            >
              <ZoomOut size={16} />
            </button>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', width: 44, textAlign: 'center' }}>
              {Math.round(zoom * 100)}%
            </span>
            <button
              style={zoomBtnStyle}
              onClick={() => setZoom(z => Math.min(10, z + 0.25))}
              title="Zoom in"
            >
              <ZoomIn size={16} />
            </button>
            <button
              style={zoomBtnStyle}
              onClick={() => { setZoom(1); setPosition({ x: 0, y: 0 }) }}
              title="Fit to view"
            >
              <Maximize2 size={16} />
            </button>
          </div>
        )}

        <button
          onClick={close}
          style={{
            background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 8,
            padding: 8, cursor: 'pointer', color: '#fff',
          }}
        >
          <X size={18} />
        </button>
      </div>

      {/* Content with nav buttons */}
      <div
        ref={contentRef}
        style={{
          flex: 1, overflow: 'hidden', position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: isPdf ? 'default' : (dragging ? 'grabbing' : 'grab'),
        }}
        onClick={e => e.stopPropagation()}
        onMouseDown={isPdf ? undefined : handleMouseDown}
        onMouseMove={isPdf ? undefined : handleMouseMove}
        onMouseUp={isPdf ? undefined : handleMouseUp}
        onMouseLeave={isPdf ? undefined : handleMouseUp}
      >
        {/* Previous button */}
        {hasPrev && (
          <button
            onClick={e => { e.stopPropagation(); goPrev() }}
            onMouseDown={e => e.stopPropagation()}
            style={{ ...navBtnStyle, left: 16 }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}
          >
            <ChevronLeft size={24} />
          </button>
        )}

        {/* Next button */}
        {hasNext && (
          <button
            onClick={e => { e.stopPropagation(); goNext() }}
            onMouseDown={e => e.stopPropagation()}
            style={{ ...navBtnStyle, right: 16 }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}
          >
            <ChevronRight size={24} />
          </button>
        )}

        {renderContent()}
      </div>

      {/* Hint */}
      <div style={{ padding: '8px 0', textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>
        ← → navigate &nbsp;·&nbsp; scroll zoom &nbsp;·&nbsp; drag pan &nbsp;·&nbsp; Space / Esc close
      </div>
    </div>,
    document.body
  )
}
