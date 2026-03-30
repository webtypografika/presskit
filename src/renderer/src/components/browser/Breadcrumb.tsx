import { ChevronRight } from 'lucide-react'
import { useAppStore } from '@/stores/app-store'

export function Breadcrumb() {
  const { currentPath, navigateTo, source } = useAppStore()

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

  return (
    <div className="flex items-center h-full gap-0.5 overflow-x-auto text-xs no-scrollbar">
      {pathSegments.map((segment, i) => (
        <div key={segment.path} className="flex items-center gap-0.5 flex-shrink-0">
          {i > 0 && <ChevronRight size={12} className="text-text-muted" />}
          <button
            className={`px-1.5 py-0.5 rounded hover:bg-bg-hover transition-colors truncate max-w-[160px] ${
              i === pathSegments.length - 1 ? 'text-text-primary' : 'text-text-secondary'
            }`}
            onClick={() => navigateTo(segment.path)}
          >
            {segment.label}
          </button>
        </div>
      ))}
    </div>
  )
}
