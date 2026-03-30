import { useEffect, useRef, useState, useCallback } from 'react'
import { ZoomIn, ZoomOut, ChevronLeft, ChevronRight } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'

// Set worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

export function PdfPreview({ data }: { data: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [pdf, setPdf] = useState<any>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [rendering, setRendering] = useState(false)

  // Load PDF
  useEffect(() => {
    if (!data) return
    let cancelled = false

    const loadPdf = async () => {
      try {
        const doc = await pdfjsLib.getDocument(data).promise
        if (cancelled) return
        setPdf(doc)
        setTotalPages(doc.numPages)
        setPage(1)
      } catch (e) {
        console.error('PDF load error:', e)
      }
    }

    loadPdf()
    return () => { cancelled = true }
  }, [data])

  // Render page
  const renderPage = useCallback(async () => {
    if (!pdf || !canvasRef.current || rendering) return
    setRendering(true)

    try {
      const pg = await pdf.getPage(page)
      const viewport = pg.getViewport({ scale: zoom * 1.5 }) // 1.5x for sharpness

      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')!
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = `${viewport.width / 1.5}px`
      canvas.style.height = `${viewport.height / 1.5}px`

      await pg.render({ canvasContext: ctx, viewport }).promise
    } catch (e) {
      console.error('PDF render error:', e)
    } finally {
      setRendering(false)
    }
  }, [pdf, page, zoom])

  useEffect(() => {
    renderPage()
  }, [renderPage])

  // Fit to width on first load
  useEffect(() => {
    if (!pdf || !containerRef.current) return
    const fitToContainer = async () => {
      const pg = await pdf.getPage(1)
      const viewport = pg.getViewport({ scale: 1 })
      const containerWidth = containerRef.current!.clientWidth - 40
      const scale = containerWidth / viewport.width
      setZoom(Math.min(scale, 2))
    }
    fitToContainer()
  }, [pdf])

  return (
    <div className="h-full flex flex-col" style={{ background: '#1a1f2e' }}>
      {/* Controls */}
      <div className="flex items-center justify-center flex-shrink-0" style={{
        height: 40, gap: 6, background: '#151c2e', borderBottom: '1px solid #1e293b',
      }}>
        {/* Page navigation */}
        {totalPages > 1 && (
          <>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              style={{ padding: '4px 6px', border: 'none', background: 'transparent', color: page <= 1 ? '#334155' : '#94a3b8', cursor: 'pointer' }}
            >
              <ChevronLeft size={16} />
            </button>
            <span style={{ fontSize: 13, color: '#e2e8f0', minWidth: 60, textAlign: 'center' }}>
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              style={{ padding: '4px 6px', border: 'none', background: 'transparent', color: page >= totalPages ? '#334155' : '#94a3b8', cursor: 'pointer' }}
            >
              <ChevronRight size={16} />
            </button>
            <div style={{ width: 1, height: 16, background: '#1e293b', margin: '0 4px' }} />
          </>
        )}

        {/* Zoom */}
        <button
          onClick={() => setZoom(z => Math.max(0.25, z - 0.25))}
          style={{ padding: '4px 6px', border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}
        >
          <ZoomOut size={16} />
        </button>
        <span style={{ fontSize: 13, color: '#e2e8f0', minWidth: 44, textAlign: 'center' }}>
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => setZoom(z => Math.min(4, z + 0.25))}
          style={{ padding: '4px 6px', border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}
        >
          <ZoomIn size={16} />
        </button>
        <button
          onClick={() => setZoom(1)}
          style={{ padding: '4px 6px', border: 'none', background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: 12 }}
        >
          Reset
        </button>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto"
        style={{ display: 'flex', justifyContent: 'center', padding: 20 }}
      >
        <canvas
          ref={canvasRef}
          style={{ boxShadow: '0 4px 20px rgba(0,0,0,0.4)', borderRadius: 2 }}
        />
      </div>
    </div>
  )
}
