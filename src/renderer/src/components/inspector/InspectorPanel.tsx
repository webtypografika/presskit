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

  if (!selectedFile || selectedFile.isDirectory) return null

  return (
    <div className="h-full flex flex-col bg-bg-secondary">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border flex-shrink-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`flex items-center gap-2 px-4 py-3 text-sm transition-colors border-b-2 ${
              inspectorTab === tab.id
                ? 'text-accent border-accent'
                : 'text-text-secondary border-transparent hover:text-text-primary hover:bg-bg-hover'
            }`}
            onClick={() => setInspectorTab(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {inspectorTab === 'metadata' && <FileMetadata />}
        {inspectorTab === 'preflight' && <PreflightReport />}
        {inspectorTab === 'presscal' && <PresscalPanel />}
      </div>
    </div>
  )
}
