import { useState, useEffect, useRef, useCallback } from 'react'
import { useAppStore } from '@/stores/app-store'
import { formatFileSize, getFileTypeLabel, isPreviewable } from '@/lib/file-types'
import { Loader2, StickyNote } from 'lucide-react'

import { renderPdfThumbnail } from '@/lib/pdf-thumbnail'

export function FileMetadata() {
  const { metadata, metadataLoading, selectedFile } = useAppStore()

  if (metadataLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={20} className="animate-spin text-text-muted" />
      </div>
    )
  }

  if (!metadata || !selectedFile) {
    return (
      <div className="text-text-muted text-xs text-center" style={{ padding: 20 }}>
        Select a file to view metadata
      </div>
    )
  }

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20, overflow: 'hidden', minWidth: 0 }}>
      {/* Mini preview */}
      {selectedFile && !selectedFile.isDirectory && isPreviewable(selectedFile.type) && (
        <MiniPreview file={selectedFile} />
      )}

      {/* Basic info */}
      <MetadataSection title="File">
        <MetadataRow label="Name" value={metadata.name} />
        <MetadataRow label="Type" value={getFileTypeLabel(metadata.type)} />
        <MetadataRow label="Size" value={formatFileSize(metadata.size)} />
        <MetadataRow label="Path" value={metadata.directory} mono small />
        <MetadataRow label="Created" value={formatDate(metadata.created)} />
        <MetadataRow label="Modified" value={formatDate(metadata.modified)} />
      </MetadataSection>

      {/* Image dimensions */}
      {metadata.width && metadata.height && (
        <MetadataSection title="Dimensions">
          <MetadataRow label="Pixels" value={`${metadata.width} x ${metadata.height}`} />
          {metadata.dpi && (
            <>
              <MetadataRow
                label="DPI"
                value={String(metadata.dpi)}
                highlight={metadata.dpi < 300 ? 'warning' : 'pass'}
              />
              <MetadataRow
                label="Print Size"
                value={`${((metadata.width / metadata.dpi) * 25.4).toFixed(1)} x ${((metadata.height / metadata.dpi) * 25.4).toFixed(1)} mm`}
              />
            </>
          )}
        </MetadataSection>
      )}

      {/* PDF dimensions */}
      {metadata.mediaBox && (
        <MetadataSection title="Page Size">
          <MetadataRow label="Media" value={`${metadata.mediaBox.width} × ${metadata.mediaBox.height} mm`} />
          {metadata.trimBox && (
            <MetadataRow label="Trim" value={`${metadata.trimBox.width} × ${metadata.trimBox.height} mm`} />
          )}
          {metadata.bleedBox && (
            <MetadataRow label="Bleed" value={`${metadata.bleedBox.width} × ${metadata.bleedBox.height} mm`} />
          )}
          {metadata.cropBox && (
            <MetadataRow label="Crop" value={`${metadata.cropBox.width} × ${metadata.cropBox.height} mm`} />
          )}
          {metadata.pageCount && (
            <MetadataRow label="Pages" value={String(metadata.pageCount)} />
          )}
          {metadata.pdfVersion && (
            <MetadataRow label="PDF Version" value={metadata.pdfVersion} />
          )}
        </MetadataSection>
      )}

      {/* Color */}
      {metadata.colorSpace && (
        <MetadataSection title="Color">
          <MetadataRow
            label="Color Space"
            value={metadata.colorSpace.toUpperCase()}
            highlight={metadata.colorSpace.toLowerCase() === 'cmyk' ? 'pass' : 'warning'}
          />
          {metadata.channels && <MetadataRow label="Channels" value={String(metadata.channels)} />}
          {metadata.bitDepth && <MetadataRow label="Bit Depth" value={String(metadata.bitDepth)} />}
          {metadata.hasAlpha !== undefined && (
            <MetadataRow label="Alpha" value={metadata.hasAlpha ? 'Yes' : 'No'} />
          )}
          {metadata.iccProfile && (
            <MetadataRow label="ICC Profile" value="Embedded" highlight="pass" />
          )}
        </MetadataSection>
      )}

      {/* PSD layers */}
      {metadata.layerCount !== undefined && (
        <MetadataSection title="Layers">
          <MetadataRow label="Layer Count" value={String(metadata.layerCount)} />
        </MetadataSection>
      )}

      {/* Font info */}
      {metadata.fontFamily && (
        <MetadataSection title="Font">
          <MetadataRow label="Family" value={metadata.fontFamily} />
          {metadata.fontSubfamily && <MetadataRow label="Style" value={metadata.fontSubfamily} />}
          {metadata.designer && <MetadataRow label="Designer" value={metadata.designer} />}
          {metadata.manufacturer && <MetadataRow label="Foundry" value={metadata.manufacturer} />}
          {metadata.glyphCount && <MetadataRow label="Glyphs" value={String(metadata.glyphCount)} />}
          {metadata.version && <MetadataRow label="Version" value={metadata.version} />}
          {metadata.openTypeFeatures && metadata.openTypeFeatures.length > 0 && (
            <MetadataRow label="OT Features" value={metadata.openTypeFeatures.join(', ')} />
          )}
        </MetadataSection>
      )}

      {/* Notes */}
      <FileNotes filePath={selectedFile.path} />
    </div>
  )
}

function FileNotes({ filePath }: { filePath: string }) {
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load note when file changes
  useEffect(() => {
    let cancelled = false
    setNote('')
    setSaved(true)
    window.api.fs.getNotes(filePath)
      .then(n => { if (!cancelled) setNote(n) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [filePath])

  // Auto-save with debounce
  const handleChange = useCallback((value: string) => {
    setNote(value)
    setSaved(false)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      window.api.fs.setNotes(filePath, value)
        .then(() => setSaved(true))
        .catch(() => {})
    }, 500)
  }, [filePath])

  return (
    <MetadataSection title="Notes">
      <div style={{ position: 'relative' }}>
        <textarea
          value={note}
          onChange={e => handleChange(e.target.value)}
          placeholder="Προσθήκη σημείωσης..."
          style={{
            width: '100%', minHeight: 64, padding: '8px 10px', fontSize: 12,
            background: 'var(--th-bg-primary)', border: '1px solid var(--th-border)',
            borderRadius: 8, color: 'var(--th-text-primary)', resize: 'vertical',
            outline: 'none', fontFamily: 'inherit', lineHeight: 1.5,
          }}
          onFocus={e => e.currentTarget.style.borderColor = '#f58220'}
          onBlur={e => e.currentTarget.style.borderColor = 'var(--th-border)'}
        />
        {!saved && (
          <div style={{ position: 'absolute', top: 6, right: 8, fontSize: 10, color: 'var(--th-text-muted)' }}>
            ...
          </div>
        )}
      </div>
    </MetadataSection>
  )
}

function MiniPreview({ file }: { file: import('@/lib/file-types').FileEntry }) {
  const [thumb, setThumb] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setThumb(null)

    const isPdf = file.type === 'pdf' || file.type === 'ai'

    if (isPdf) {
      renderPdfThumbnail(file.path, 280)
        .then(data => { if (!cancelled) setThumb(data) })
        .catch(() => {})
    } else {
      window.api.preview.thumbnail(file.path, 280)
        .then(data => { if (!cancelled) setThumb(data) })
        .catch(() => {})
    }

    return () => { cancelled = true }
  }, [file.path, file.type])

  if (!thumb) return null

  return (
    <div
      className="rounded-lg overflow-hidden border border-border bg-bg-primary flex items-center justify-center"
      style={{ maxHeight: 200 }}
    >
      <img
        src={thumb}
        alt={file.name}
        style={{ maxWidth: '100%', maxHeight: 200, objectFit: 'contain' }}
        draggable={false}
      />
    </div>
  )
}

function MetadataSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm font-medium text-text-muted uppercase tracking-wider mb-1.5">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function MetadataRow({ label, value, highlight, mono, small }: {
  label: string
  value: string
  highlight?: 'pass' | 'warning' | 'error'
  mono?: boolean
  small?: boolean
}) {
  const valueColor = highlight === 'pass' ? 'text-success'
    : highlight === 'warning' ? 'text-warning'
    : highlight === 'error' ? 'text-error'
    : 'text-text-primary'

  return (
    <div className="flex items-start gap-3 py-0.5">
      <span className="text-sm text-text-muted w-24 flex-shrink-0">{label}</span>
      <span className={`text-sm ${valueColor} ${mono ? 'font-mono' : ''} ${small ? 'text-xs' : ''} break-all`}>
        {value}
      </span>
    </div>
  )
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleDateString('el-GR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}
