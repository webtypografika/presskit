import { useState, useRef, useCallback, useEffect } from 'react'
import { ZoomIn, ZoomOut, RotateCw, Maximize2, Eye, EyeOff } from 'lucide-react'
import type { LayerInfo } from '@/lib/file-types'

export function ImagePreview({ data, layers }: { data: string; layers?: LayerInfo[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const posStartRef = useRef({ x: 0, y: 0 })

  // Fit to container on initial load
  useEffect(() => {
    setZoom(1)
    setRotation(0)
    setPosition({ x: 0, y: 0 })
  }, [data])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.1 : 0.1
    setZoom(z => Math.max(0.1, Math.min(10, z + delta)))
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

  return (
    <div className="h-full flex flex-col">
      {/* Image controls */}
      <div className="h-7 flex items-center justify-center gap-2 bg-bg-tertiary border-b border-border flex-shrink-0">
        <button
          className="p-0.5 text-text-muted hover:text-text-primary"
          onClick={() => setZoom(z => Math.max(0.1, z - 0.25))}
          title="Zoom out"
        >
          <ZoomOut size={14} />
        </button>
        <span className="text-sm text-text-secondary w-12 text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          className="p-0.5 text-text-muted hover:text-text-primary"
          onClick={() => setZoom(z => Math.min(10, z + 0.25))}
          title="Zoom in"
        >
          <ZoomIn size={14} />
        </button>

        <div className="w-px h-4 bg-border mx-1" />

        <button
          className="p-0.5 text-text-muted hover:text-text-primary"
          onClick={() => setRotation(r => (r + 90) % 360)}
          title="Rotate"
        >
          <RotateCw size={14} />
        </button>
        <button
          className="p-0.5 text-text-muted hover:text-text-primary"
          onClick={fitToView}
          title="Fit to view"
        >
          <Maximize2 size={14} />
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Image area */}
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden cursor-grab active:cursor-grabbing bg-[#0d1117]"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{
            // Checker pattern for transparency
            backgroundImage: `
              linear-gradient(45deg, #1a1f2e 25%, transparent 25%),
              linear-gradient(-45deg, #1a1f2e 25%, transparent 25%),
              linear-gradient(45deg, transparent 75%, #1a1f2e 75%),
              linear-gradient(-45deg, transparent 75%, #1a1f2e 75%)
            `,
            backgroundSize: '20px 20px',
            backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px'
          }}
        >
          <div className="w-full h-full flex items-center justify-center">
            <img
              src={data}
              alt="Preview"
              draggable={false}
              className="max-w-none"
              style={{
                transform: `translate(${position.x}px, ${position.y}px) scale(${zoom}) rotate(${rotation}deg)`,
                transformOrigin: 'center center',
                transition: dragging ? 'none' : 'transform 0.1s ease-out'
              }}
            />
          </div>
        </div>

        {/* Layer panel for PSD */}
        {layers && layers.length > 0 && (
          <div className="w-48 bg-bg-secondary border-l border-border overflow-y-auto flex-shrink-0">
            <div className="px-2 py-1.5 text-sm font-medium text-text-muted uppercase tracking-wider border-b border-border">
              Layers ({layers.length})
            </div>
            {layers.map((layer, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-bg-hover"
              >
                {layer.visible ? (
                  <Eye size={12} className="text-text-muted flex-shrink-0" />
                ) : (
                  <EyeOff size={12} className="text-text-muted flex-shrink-0 opacity-40" />
                )}
                <span className={`truncate ${layer.visible ? 'text-text-secondary' : 'text-text-muted opacity-50'}`}>
                  {layer.name}
                </span>
                {layer.opacity < 1 && (
                  <span className="ml-auto text-xs text-text-muted">
                    {Math.round(layer.opacity * 100)}%
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
