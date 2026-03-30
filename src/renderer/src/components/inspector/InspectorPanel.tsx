import { useAppStore } from '@/stores/app-store'
import { FileMetadata } from './FileMetadata'
import { PreflightReport } from './PreflightReport'
import { PresscalPanel } from '../presscal/PresscalPanel'
import type { InspectorTab } from '@/stores/app-store'
import { Info, Scan, Link2 } from 'lucide-react'

const TABS: { id: InspectorTab; label: string; icon: React.ReactNode }[] = [
  { id: 'metadata', label: 'Info', icon: <Info size={14} /> },
  { id: 'preflight', label: 'Preflight', icon: <Scan size={14} /> },
  { id: 'presscal', label: 'PressCal', icon: <Link2 size={14} /> }
]

export function InspectorPanel() {
  const { inspectorTab, setInspectorTab, selectedFile } = useAppStore()

  const hasFile = selectedFile && !selectedFile.isDirectory

  return (
    <div className="h-full flex flex-col bg-bg-secondary">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border flex-shrink-0">
        {TABS.map(tab => {
          const disabled = !hasFile && tab.id !== 'presscal'
          return (
            <button
              key={tab.id}
              className={`flex items-center gap-2 text-sm transition-colors border-b-2 ${
                inspectorTab === tab.id
                  ? 'text-accent border-accent'
                  : disabled
                    ? 'text-text-muted border-transparent cursor-default'
                    : 'text-text-secondary border-transparent hover:text-text-primary hover:bg-bg-hover'
              }`}
              style={{ padding: '12px 14px', opacity: disabled ? 0.4 : 1 }}
              onClick={() => !disabled && setInspectorTab(tab.id)}
            >
              {tab.icon}
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {inspectorTab === 'metadata' && hasFile && <FileMetadata />}
        {inspectorTab === 'preflight' && hasFile && <PreflightReport />}
        {inspectorTab === 'presscal' && <PresscalPanel />}
        {!hasFile && inspectorTab !== 'presscal' && (
          <div className="flex items-center justify-center h-full" style={{ color: '#475569', fontSize: 13 }}>
            Επιλέξτε αρχείο
          </div>
        )}
      </div>
    </div>
  )
}
