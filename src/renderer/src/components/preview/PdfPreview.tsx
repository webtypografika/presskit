import { useEffect, useRef, useState, useCallback } from 'react'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react'

// PDF.js will be loaded from the renderer bundle
// For now, we render the PDF data as an embedded object with fallback to iframe
export function PdfPreview({ data }: { data: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [zoom, setZoom] = useState(1)

  // Use iframe/embed approach for PDF rendering
  // PDF.js integration can be added later for more control
  return (
    <div className="h-full flex flex-col">
      {/* PDF controls */}
      <div className="h-7 flex items-center justify-center gap-2 bg-bg-tertiary border-b border-border flex-shrink-0">
        <button
          className="p-0.5 text-text-muted hover:text-text-primary disabled:opacity-30"
          onClick={() => setZoom(z => Math.max(0.25, z - 0.25))}
          title="Zoom out"
        >
          <ZoomOut size={14} />
        </button>
        <span className="text-sm text-text-secondary w-12 text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          className="p-0.5 text-text-muted hover:text-text-primary disabled:opacity-30"
          onClick={() => setZoom(z => Math.min(4, z + 0.25))}
          title="Zoom in"
        >
          <ZoomIn size={14} />
        </button>
      </div>

      {/* PDF content */}
      <div ref={containerRef} className="flex-1 overflow-auto flex items-start justify-center p-2">
        <embed
          src={data}
          type="application/pdf"
          className="bg-white shadow-lg"
          style={{
            width: `${Math.round(595 * zoom)}px`,
            height: `${Math.round(842 * zoom)}px`,
            minHeight: '100%'
          }}
        />
      </div>
    </div>
  )
}
