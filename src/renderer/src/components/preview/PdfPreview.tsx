import { useState } from 'react'
import { ZoomIn, ZoomOut, RotateCw } from 'lucide-react'

export function PdfPreview({ data }: { data: string }) {
  const [zoom, setZoom] = useState(100)

  // Append #toolbar=1&navpanes=0 to hide sidebar, show toolbar
  const pdfUrl = data.includes('#') ? data : `${data}#toolbar=1&navpanes=0&scrollbar=1&view=FitH`

  return (
    <div className="h-full flex flex-col">
      {/* Minimal controls */}
      <div className="flex items-center justify-center flex-shrink-0" style={{
        height: 36, gap: 8, background: '#151c2e', borderBottom: '1px solid #1e293b',
      }}>
        <button
          onClick={() => setZoom(z => Math.max(25, z - 25))}
          style={{ padding: '4px 8px', border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', borderRadius: 4 }}
          title="Zoom out"
        >
          <ZoomOut size={16} />
        </button>
        <span style={{ fontSize: 13, color: '#e2e8f0', minWidth: 44, textAlign: 'center' }}>{zoom}%</span>
        <button
          onClick={() => setZoom(z => Math.min(400, z + 25))}
          style={{ padding: '4px 8px', border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', borderRadius: 4 }}
          title="Zoom in"
        >
          <ZoomIn size={16} />
        </button>
        <div style={{ width: 1, height: 16, background: '#1e293b', margin: '0 4px' }} />
        <button
          onClick={() => setZoom(100)}
          style={{ padding: '4px 8px', border: 'none', background: 'transparent', color: '#64748b', cursor: 'pointer', borderRadius: 4, fontSize: 12 }}
        >
          Reset
        </button>
      </div>

      {/* PDF display — iframe without sidebar */}
      <div className="flex-1 overflow-hidden" style={{ background: '#525659' }}>
        <iframe
          src={pdfUrl}
          title="PDF Preview"
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            transform: `scale(${zoom / 100})`,
            transformOrigin: 'top left',
            width: `${10000 / zoom}%`,
            height: `${10000 / zoom}%`,
          }}
        />
      </div>
    </div>
  )
}
