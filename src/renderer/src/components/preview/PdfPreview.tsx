import { useEffect, useRef, useState, useCallback } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
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

  // Render page — fit to container
  const renderPage = useCallback(async () => {
    if (!pdf || !canvasRef.current || !containerRef.current || rendering) return
    setRendering(true)

    try {
      const pg = await pdf.getPage(page)
      const container = containerRef.current
      const containerW = container.clientWidth
      const containerH = container.clientHeight

      // Get natural page size
      const baseViewport = pg.getViewport({ scale: 1 })

      // Calculate scale to fit container (both width and height)
      const scaleW = containerW / baseViewport.width
      const scaleH = containerH / baseViewport.height
      const fitScale = Math.min(scaleW, scaleH)

      // Render at 2x for sharpness, display at 1x
      const renderScale = fitScale * 2
      const viewport = pg.getViewport({ scale: renderScale })

      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')!
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = `${viewport.width / 2}px`
      canvas.style.height = `${viewport.height / 2}px`

      // White background for the page
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, viewport.width, viewport.height)

      await pg.render({ canvasContext: ctx, viewport }).promise
    } catch (e) {
      console.error('PDF render error:', e)
    } finally {
      setRendering(false)
    }
  }, [pdf, page])

  useEffect(() => {
    renderPage()
  }, [renderPage])

  // Re-render on resize
  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(() => { renderPage() })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [renderPage])

  return (
    <div className="h-full flex flex-col">
      {/* Canvas — fills entire area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden flex items-center justify-center"
      >
        <canvas ref={canvasRef} />
      </div>

      {/* Page nav — only if multi-page, small bar at bottom */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center flex-shrink-0 bg-bg-secondary border-t border-border" style={{ height: 32, gap: 8 }}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="text-text-muted hover:text-text-primary disabled:opacity-30"
            style={{ padding: '2px 6px', border: 'none', background: 'transparent', cursor: 'pointer' }}
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-text-secondary" style={{ fontSize: 11 }}>
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="text-text-muted hover:text-text-primary disabled:opacity-30"
            style={{ padding: '2px 6px', border: 'none', background: 'transparent', cursor: 'pointer' }}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
