import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '@/stores/app-store'
import { X, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import { PdfPreview } from './PdfPreview'
import { ImagePreview } from './ImagePreview'

export function FullscreenPreview() {
  const fullscreenPreview = useAppStore(s => s.fullscreenPreview)
  const selectedFile = useAppStore(s => s.selectedFile)
  const files = useAppStore(s => s.files)
  const selectFile = useAppStore(s => s.selectFile)
  const storePreview = useAppStore(s => s.preview)

  const [localPreview, setLocalPreview] = useState<any>(null)
  const [loading, setLoading] = useState(false)

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

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.92)',
        display: 'flex', flexDirection: 'column',
      }}
      onClick={close}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between"
        style={{ padding: '12px 20px', flexShrink: 0 }}
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
        style={{ flex: 1, overflow: 'hidden', position: 'relative' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Previous button */}
        {hasPrev && (
          <button
            onClick={goPrev}
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
            onClick={goNext}
            style={{ ...navBtnStyle, right: 16 }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}
          >
            <ChevronRight size={24} />
          </button>
        )}

        {loading && (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Loader2 size={32} className="animate-spin" style={{ color: '#fff' }} />
          </div>
        )}
        {!loading && preview?.type === 'pdf-page' && <PdfPreview data={preview.data} />}
        {!loading && preview?.type === 'image' && <ImagePreview data={preview.data} layers={preview.layers} />}
        {!loading && preview?.type === 'svg' && (
          <div
            className="w-full h-full flex items-center justify-center overflow-auto"
            style={{ padding: 32 }}
            dangerouslySetInnerHTML={{ __html: preview.data }}
          />
        )}
        {!loading && !preview && (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>
            No preview available
          </div>
        )}
      </div>

      {/* Hint */}
      <div style={{ padding: '8px 0', textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>
        ← → navigate &nbsp;·&nbsp; Space / Esc close
      </div>
    </div>,
    document.body
  )
}
