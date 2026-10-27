import { useEffect, useRef, useState, useCallback } from 'react'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'

// Set worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

export function PdfPreview({ data, fullscreen }: { data: string; fullscreen?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // 🔍 THE DETAIL CANVAS (George 27/10/2026: «το zoom είναι κακό… θέλω τη μέγιστη ανάλυση»). The page
  // canvas below is drawn once, at the size that fits the pane, and zoom only scaled that picture up —
  // blurry by 200%, mush by 1000%. This canvas covers just the part of the page that is on screen and
  // is redrawn from the PDF itself, at the screen's own pixels, every time zoom or pan settles: sharp at
  // any zoom, and never bigger than the pane, so memory does not grow with the zoom.
  const detailRef = useRef<HTMLCanvasElement>(null)
  const detailTaskRef = useRef<any>(null)
  const fitRef = useRef<{ scale: number; dispW: number; dispH: number } | null>(null)
  const [detailKey, setDetailKey] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const pdfRef = useRef<any>(null)
  const renderingRef = useRef(false)
  const pendingRenderRef = useRef(false)
  const renderIdRef = useRef(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const posStartRef = useRef({ x: 0, y: 0 })

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

  // Reset zoom/pan on page or data change
  useEffect(() => {
    setZoom(1)
    setPosition({ x: 0, y: 0 })
  }, [data, page])

  // Wheel zoom — must use native listener to allow preventDefault (React onWheel is passive)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      setZoom(z => Math.max(0.1, Math.min(10, z + delta)))
    }
    container.addEventListener('wheel', handler, { passive: false })
    return () => container.removeEventListener('wheel', handler)
  }, [])

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

  const fitToView = useCallback(() => {
    setZoom(1)
    setPosition({ x: 0, y: 0 })
  }, [])

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
      fitRef.current = { scale: fitScale, dispW: Math.floor(displayViewport.width), dispH: Math.floor(displayViewport.height) }

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

  // The key of what is on screen now; the detail canvas shows only when it was drawn for exactly this.
  const viewKey = `${page}|${zoom.toFixed(3)}|${Math.round(position.x)}|${Math.round(position.y)}`

  useEffect(() => {
    if (zoom <= 1.01 || dragging) return // at fit size the page canvas is already sharp
    const timer = setTimeout(async () => {
      const pdf = pdfRef.current, container = containerRef.current, detail = detailRef.current, fit = fitRef.current
      if (!pdf || !container || !detail || !fit) return
      try { detailTaskRef.current?.cancel() } catch { /* finished already */ }
      const cw = container.clientWidth, ch = container.clientHeight
      // Where the page lies in the pane at this zoom/pan — the page canvas is centred, then moved and
      // scaled about its centre by the CSS transform.
      const W = fit.dispW * zoom, H = fit.dispH * zoom
      const x0 = cw / 2 + position.x - W / 2, y0 = ch / 2 + position.y - H / 2
      const vx = Math.max(0, x0), vy = Math.max(0, y0)
      const vw = Math.min(cw, x0 + W) - vx, vh = Math.min(ch, y0 + H) - vy
      if (vw <= 1 || vh <= 1) return
      const dpr = window.devicePixelRatio || 1
      const pg = await pdf.getPage(page)
      const viewport = pg.getViewport({ scale: fit.scale * zoom * dpr })
      detail.width = Math.ceil(vw * dpr)
      detail.height = Math.ceil(vh * dpr)
      Object.assign(detail.style, { left: `${vx}px`, top: `${vy}px`, width: `${vw}px`, height: `${vh}px` })
      const ctx = detail.getContext('2d')!
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, detail.width, detail.height)
      const task = pg.render({
        canvasContext: ctx,
        viewport,
        // Only the visible window: shift the page so that its visible corner lands on the canvas origin.
        transform: [1, 0, 0, 1, -(vx - x0) * dpr, -(vy - y0) * dpr],
      })
      detailTaskRef.current = task
      try {
        await task.promise
        setDetailKey(viewKey)
      } catch { /* cancelled by a newer view */ }
    }, 150)
    return () => clearTimeout(timer)
  }, [viewKey, dragging]) // eslint-disable-line react-hooks/exhaustive-deps

  const toolbarCls = fullscreen
    ? 'h-7 flex items-center justify-center gap-2 flex-shrink-0'
    : 'h-7 flex items-center justify-center gap-2 bg-bg-tertiary border-b border-border flex-shrink-0'

  const toolbarBtnCls = fullscreen
    ? 'p-0.5 hover:opacity-100'
    : 'p-0.5 text-text-muted hover:text-text-primary'

  const toolbarTextCls = fullscreen
    ? 'text-sm w-12 text-center'
    : 'text-sm text-text-secondary w-12 text-center'

  const pageTextCls = fullscreen
    ? 'text-sm'
    : 'text-sm text-text-secondary'

  return (
    <div className="h-full flex flex-col">
      {/* Zoom controls */}
      <div
        className={toolbarCls}
        style={fullscreen ? { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)' } : undefined}
      >
        <button
          className={toolbarBtnCls}
          onClick={() => setZoom(z => Math.max(0.1, z - 0.25))}
          title="Zoom out"
        >
          <ZoomOut size={14} />
        </button>
        <span className={toolbarTextCls} style={fullscreen ? { color: 'rgba(255,255,255,0.6)' } : undefined}>
          {Math.round(zoom * 100)}%
        </span>
        <button
          className={toolbarBtnCls}
          onClick={() => setZoom(z => Math.min(10, z + 0.25))}
          title="Zoom in"
        >
          <ZoomIn size={14} />
        </button>
        <div className="w-px h-4 mx-1" style={fullscreen ? { background: 'rgba(255,255,255,0.2)' } : undefined} />
        <button
          className={toolbarBtnCls}
          onClick={fitToView}
          title="Fit to view"
        >
          <Maximize2 size={14} />
        </button>

        {/* Page nav inline — only if multi-page */}
        {totalPages > 1 && (
          <>
            <div className="w-px h-4 mx-1" style={fullscreen ? { background: 'rgba(255,255,255,0.2)' } : undefined} />
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className={`${toolbarBtnCls} disabled:opacity-30`}
            >
              <ChevronLeft size={14} />
            </button>
            <span className={pageTextCls} style={fullscreen ? { fontSize: 11, color: 'rgba(255,255,255,0.6)' } : { fontSize: 11 }}>
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className={`${toolbarBtnCls} disabled:opacity-30`}
            >
              <ChevronRight size={14} />
            </button>
          </>
        )}
      </div>

      {/* Canvas container — fills entire area */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden flex items-center justify-center cursor-grab active:cursor-grabbing"
        style={{ background: fullscreen ? 'transparent' : '#525659' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
            transition: dragging ? 'none' : 'transform 0.1s ease-out'
          }}
        />
        <canvas
          ref={detailRef}
          style={{
            position: 'absolute',
            pointerEvents: 'none',
            visibility: zoom > 1.01 && !dragging && detailKey === viewKey ? 'visible' : 'hidden',
          }}
        />
      </div>
    </div>
  )
}
