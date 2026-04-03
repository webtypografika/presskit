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
  const pdfRef = useRef<any>(null)
  const renderingRef = useRef(false)
  const pendingRenderRef = useRef(false)
  const renderIdRef = useRef(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)

  // Load PDF
  useEffect(() => {
    if (!data) return
    let cancelled = false

    const loadPdf = async () => {
      try {
        const doc = await pdfjsLib.getDocument(data).promise
        if (cancelled) return
        pdfRef.current = doc
        setTotalPages(doc.numPages)
        setPage(1)
      } catch (e) {
        console.error('PDF load error:', e)
      }
    }

    loadPdf()
    return () => {
      cancelled = true
      pdfRef.current = null
    }
  }, [data])

  // Render page — fit to container, DPR-aware
  const renderPage = useCallback(async () => {
    const pdf = pdfRef.current
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!pdf || !canvas || !container) return

    // Prevent overlapping renders — use ref (synchronous) not state
    if (renderingRef.current) {
      pendingRenderRef.current = true
      return
    }
    renderingRef.current = true
    const thisRenderId = ++renderIdRef.current

    try {
      const pg = await pdf.getPage(page)

      // Check if this render is still relevant
      if (thisRenderId !== renderIdRef.current) return

      const containerW = container.clientWidth
      const containerH = container.clientHeight
      if (containerW <= 0 || containerH <= 0) return

      // Get natural page size
      const baseViewport = pg.getViewport({ scale: 1 })

      // Calculate scale to fit container
      const scaleW = containerW / baseViewport.width
      const scaleH = containerH / baseViewport.height
      const fitScale = Math.min(scaleW, scaleH) * 0.95 // 5% padding

      // Use devicePixelRatio for sharp rendering
      const dpr = window.devicePixelRatio || 1
      const displayViewport = pg.getViewport({ scale: fitScale })
      const renderViewport = pg.getViewport({ scale: fitScale * dpr })

      // Set canvas buffer size (actual pixels)
      canvas.width = Math.floor(renderViewport.width)
      canvas.height = Math.floor(renderViewport.height)

      // Set canvas display size (CSS pixels)
      canvas.style.width = `${Math.floor(displayViewport.width)}px`
      canvas.style.height = `${Math.floor(displayViewport.height)}px`

      const ctx = canvas.getContext('2d')!

      // Reset any previous transform
      ctx.setTransform(1, 0, 0, 1, 0, 0)

      // White background
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Check if still relevant before expensive render
      if (thisRenderId !== renderIdRef.current) return

      await pg.render({
        canvasContext: ctx,
        viewport: renderViewport,
      }).promise

    } catch (e) {
      // Cancelled render is expected, only log real errors
      if (thisRenderId === renderIdRef.current) {
        console.error('PDF render error:', e)
      }
    } finally {
      renderingRef.current = false

      // If a render was requested while we were busy, do it now
      if (pendingRenderRef.current) {
        pendingRenderRef.current = false
        renderPage()
      }
    }
  }, [page])

  // Render when page changes or PDF loads
  useEffect(() => {
    if (pdfRef.current) {
      renderPage()
    }
  }, [renderPage, totalPages])

  // Re-render on resize with debounce
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let resizeTimer: ReturnType<typeof setTimeout> | null = null

    const observer = new ResizeObserver(() => {
      // Debounce: wait for resize to settle
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        renderPage()
      }, 100)
    })

    observer.observe(container)
    return () => {
      observer.disconnect()
      if (resizeTimer) clearTimeout(resizeTimer)
    }
  }, [renderPage])

  return (
    <div className="h-full flex flex-col">
      {/* Canvas container — fills entire area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden flex items-center justify-center"
        style={{ background: '#525659' }}
      >
        <canvas ref={canvasRef} style={{ display: 'block' }} />
      </div>

      {/* Page nav — only if multi-page */}
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
