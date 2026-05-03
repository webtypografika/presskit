import { useState } from 'react'
import { ChevronRight, Copy, Check } from 'lucide-react'
import { useAppStore } from '@/stores/app-store'

export function Breadcrumb() {
  const currentPath = useAppStore(s => s.currentPath)
  const navigateTo = useAppStore(s => s.navigateTo)
  const source = useAppStore(s => s.source)
  const [copied, setCopied] = useState(false)

  if (!currentPath) {
    return (
      <div className="flex items-center h-full px-2 text-text-muted text-xs">
        {source === 'dropbox' ? 'Dropbox /' : 'Select a location'}
      </div>
    )
  }

  const separator = currentPath.includes('/') ? '/' : '\\'
  const parts = currentPath.split(/[/\\]/).filter(Boolean)

  // For Windows paths like C:\Users\... first part is "C:"
  const pathSegments: { label: string; path: string }[] = []
  let accumulated = ''

  for (let i = 0; i < parts.length; i++) {
    if (i === 0 && parts[0].endsWith(':')) {
      accumulated = parts[0] + separator
      pathSegments.push({ label: parts[0], path: accumulated })
    } else {
      accumulated += (i === 1 && parts[0].endsWith(':') ? '' : separator) + parts[i]
      pathSegments.push({ label: parts[i], path: accumulated })
    }
  }

  const copyPath = () => {
    navigator.clipboard.writeText(currentPath)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex items-center h-full overflow-x-auto text-xs no-scrollbar" style={{ padding: '0 12px', gap: 2 }}>
      {pathSegments.map((segment, i) => (
        <div key={segment.path} className="flex items-center flex-shrink-0" style={{ gap: 2 }}>
          {i > 0 && <ChevronRight size={11} className="text-text-muted" style={{ margin: '0 4px' }} />}
          <button
            className={`rounded hover:bg-bg-hover transition-colors truncate max-w-[180px] ${
              i === pathSegments.length - 1 ? 'text-text-primary font-medium' : 'text-text-secondary'
            }`}
            style={{ padding: '4px 8px' }}
            onClick={() => navigateTo(segment.path)}
          >
            {segment.label}
          </button>
        </div>
      ))}
      <button
        onClick={copyPath}
        title="Αντιγραφή path"
        className="flex-shrink-0 rounded hover:bg-bg-hover transition-colors text-text-muted hover:text-text-primary"
        style={{ marginLeft: 8, padding: 4 }}
      >
        {copied ? <Check size={13} style={{ color: '#22c55e' }} /> : <Copy size={13} />}
      </button>
    </div>
  )
}
