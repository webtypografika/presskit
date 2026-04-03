import { useState } from 'react'
import { useAppStore } from '@/stores/app-store'
import { formatFileSize } from '@/lib/file-types'
import { HardDrive, Cloud, Link2, Scan, Settings, Sun, Moon, CircleCheck, CircleDashed } from 'lucide-react'
import { SettingsDialog } from '../tools/SettingsDialog'

export function StatusBar() {
  const {
    files, selectedFile, currentPath, source,
    presscalConnected, dropboxConnected,
    preflight, theme, setTheme,
    pickedFiles, picksFilter, setPicksFilter, clearPicks
  } = useAppStore()

  const [showSettings, setShowSettings] = useState(false)
  const isDark = theme === 'dark'

  const fileCount = files.filter(f => !f.isDirectory).length
  const folderCount = files.filter(f => f.isDirectory).length
  const pickedCount = pickedFiles.size

  return (
    <>
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

          {/* Picks counter + filter */}
          {pickedCount > 0 && (
            <>
              <div className="w-px h-4 bg-border" />
              <span className="flex items-center gap-1" style={{ color: '#22c55e', fontWeight: 600 }}>
                <CircleCheck size={12} />
                {pickedCount} picked
              </span>
              {/* Filter buttons */}
              <div style={{ display: 'flex', gap: 2, background: 'var(--th-bg-primary)', borderRadius: 6, padding: 2 }}>
                {(['all', 'picked', 'unpicked'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setPicksFilter(f)}
                    style={{
                      padding: '1px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500,
                      border: 'none', cursor: 'pointer',
                      background: picksFilter === f ? (f === 'picked' ? 'rgba(34,197,94,0.15)' : f === 'unpicked' ? 'rgba(234,179,8,0.15)' : 'rgba(245,130,32,0.15)') : 'transparent',
                      color: picksFilter === f ? (f === 'picked' ? '#22c55e' : f === 'unpicked' ? '#eab308' : '#f58220') : '#64748b',
                    }}
                  >
                    {f === 'all' ? 'All' : f === 'picked' ? 'Picked' : 'Unpicked'}
                  </button>
                ))}
              </div>
              <button
                onClick={clearPicks}
                title="Clear all picks"
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b', fontSize: 11, padding: '1px 4px' }}
              >
                Clear
              </button>
            </>
          )}

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

          {/* Divider */}
          <div className="w-px h-4 bg-border" />

          {/* Theme toggle */}
          <button
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            title={isDark ? 'Light mode' : 'Dark mode'}
            className="flex items-center hover:text-text-primary transition-colors"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 2, minHeight: 'auto' }}
          >
            {isDark ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          {/* Settings */}
          <button
            onClick={() => setShowSettings(true)}
            title="Settings"
            className="flex items-center hover:text-text-primary transition-colors"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 2, minHeight: 'auto' }}
          >
            <Settings size={14} />
          </button>
        </div>
      </div>

      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
    </>
  )
}
