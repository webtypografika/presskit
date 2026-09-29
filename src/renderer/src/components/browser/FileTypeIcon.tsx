import { Folder, Image, Type, FileSpreadsheet, Archive, File } from 'lucide-react'
import type { FileType } from '@/lib/file-types'
import { getFileTypeColor } from '@/lib/file-types'

/**
 * The file icon, for every list that shows files.
 *
 * It lived inside FileGrid, so the search dropdown drew emoji instead — a PDF
 * was 📕 in one list and an Adobe-red "Pdf" badge in the other, in the same
 * window (George, 29/09).
 */

/** Adobe-style badge: rounded square with a 2-letter abbreviation. */
function AdobeBadge({ label, bg, size }: { label: string; bg: string; size: number }) {
  const r = Math.round(size * 0.18)
  const fontSize = size <= 18 ? 9 : size <= 24 ? 11 : Math.round(size * 0.44)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <rect x={0} y={0} width={size} height={size} rx={r} ry={r} fill={bg} />
      <text
        x={size / 2} y={size / 2}
        textAnchor="middle" dominantBaseline="central"
        fill="#fff" fontFamily="system-ui, sans-serif" fontWeight={700} fontSize={fontSize}
      >
        {label}
      </text>
    </svg>
  )
}

export function FileTypeIcon({ type, size = 32 }: { type: FileType; size?: number }) {
  const color = getFileTypeColor(type)
  const iconProps = { size, color, strokeWidth: 1.5 }

  switch (type) {
    case 'folder': return <Folder {...iconProps} fill={color} fillOpacity={0.15} />
    case 'pdf': return <AdobeBadge label="Pdf" bg="#e2574c" size={size} />
    case 'ai': return <AdobeBadge label="Ai" bg="#ff7c00" size={size} />
    case 'psd': return <AdobeBadge label="Ps" bg="#31a8ff" size={size} />
    case 'eps': return <AdobeBadge label="Ep" bg="#ff7c00" size={size} />
    case 'indd': return <AdobeBadge label="Id" bg="#ff3366" size={size} />
    case 'tiff': case 'png': case 'jpg': case 'svg': case 'raw':
      return <Image {...iconProps} />
    case 'font': return <Type {...iconProps} />
    case 'spreadsheet': return <FileSpreadsheet {...iconProps} />
    case 'archive': return <Archive {...iconProps} />
    default: return <File {...iconProps} />
  }
}
