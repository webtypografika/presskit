import { useAppStore } from '@/stores/app-store'
import { formatFileSize } from '@/lib/file-types'
import { HardDrive, Cloud, Link2, Scan } from 'lucide-react'

export function StatusBar() {
  const {
    files, selectedFile, currentPath, source,
    presscalConnected, dropboxConnected,
    preflight
  } = useAppStore()

  const fileCount = files.filter(f => !f.isDirectory).length
  const folderCount = files.filter(f => f.isDirectory).length

  return (
    <div className="flex items-center justify-between bg-bg-secondary border-t border-border text-sm text-text-muted flex-shrink-0" style={{ height: 40, padding: '0 24px' }}>
      <div className="flex items-center gap-4">
        {/* Source indicator */}
        <span className="flex items-center gap-1">
          {source === 'local' ? <HardDrive size={11} /> : <Cloud size={11} />}
          {source === 'local' ? 'Local' : 'Dropbox'}
        </span>

        {/* Item count */}
        <span>
          {folderCount > 0 && `${folderCount} folders`}
          {folderCount > 0 && fileCount > 0 && ', '}
          {fileCount > 0 && `${fileCount} files`}
          {folderCount === 0 && fileCount === 0 && 'Empty'}
        </span>

        {/* Selected file info */}
        {selectedFile && !selectedFile.isDirectory && (
          <span className="text-text-secondary">
            {selectedFile.name} — {formatFileSize(selectedFile.size)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        {/* Preflight status */}
        {preflight && (
          <span className={`flex items-center gap-1 ${
            preflight.overallStatus === 'pass' ? 'text-success' :
            preflight.overallStatus === 'warning' ? 'text-warning' : 'text-error'
          }`}>
            <Scan size={11} />
            Preflight: {preflight.overallStatus.toUpperCase()}
          </span>
        )}

        {/* PressCal status */}
        <span className={`flex items-center gap-1 ${presscalConnected ? 'text-success' : 'text-text-muted'}`}>
          <Link2 size={11} />
          PressCal
        </span>

        {/* Dropbox status */}
        <span className={`flex items-center gap-1 ${dropboxConnected ? 'text-success' : 'text-text-muted'}`}>
          <Cloud size={11} />
          Dropbox
        </span>
      </div>
    </div>
  )
}
