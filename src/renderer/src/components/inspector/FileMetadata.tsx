import { useAppStore } from '@/stores/app-store'
import { formatFileSize, getFileTypeLabel } from '@/lib/file-types'
import { Loader2 } from 'lucide-react'
import { ColorPalette } from '../tools/ColorPalette'

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
      <div className="p-4 text-text-muted text-xs text-center">
        Select a file to view metadata
      </div>
    )
  }

  return (
    <div className="p-3 space-y-4">
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

      {/* Color palette & ink coverage */}
      <ColorPalette />
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
