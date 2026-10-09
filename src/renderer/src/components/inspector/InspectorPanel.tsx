import { useState } from 'react'
import { useAppStore } from '@/stores/app-store'
import { FileMetadata } from './FileMetadata'
import { PreflightReport } from './PreflightReport'
import { PresscalPanel } from '../presscal/PresscalPanel'
import { PrintChecklist } from '../tools/PrintChecklist'
import { SpotColorPanel } from '../tools/SpotColorPanel'
import { BarcodeGenerator } from '../tools/BarcodeGenerator'
import { JobFolderTemplates } from '../tools/JobFolderTemplates'
import { VersionHistory } from '../tools/VersionHistory'
import { IccProfileViewer } from '../tools/IccProfileViewer'
import { ColorPalette } from '../tools/ColorPalette'
import type { InspectorTab } from '@/stores/app-store'
import { ExtractTextPanel } from './ExtractTextPanel'
import {
  Info, Scan, Link2, Wrench,
  ClipboardCheck, Droplet, Palette, Barcode,
  FolderPlus, History, Monitor, FileText
} from 'lucide-react'

const TABS: { id: InspectorTab; label: string; icon: React.ReactNode }[] = [
  { id: 'metadata', label: 'Info', icon: <Info size={14} /> },
  { id: 'preflight', label: 'Preflight', icon: <Scan size={14} /> },
  { id: 'tools', label: 'Tools', icon: <Wrench size={14} /> },
  { id: 'presscal', label: 'PressCal', icon: <Link2 size={14} /> }
]

/* 🔴 NO 'plotter' HERE ANY MORE. The cutting plotter had a tab with a machine card, a job list
   and three run modes, and the owner wanted none of it: «δεν μας νοιάζει ούτε τι μηχανήματα ούτε
   λίστα με δουλειές ούτε τίποτα. Μόνο από presscal εντολές και ρυθμίσεις. Το presskit αναλαμβάνει
   σιωπηλά.» The cut is set up, chosen and started in PressCal; this app receives a file and a mode
   on POST /?cut=1 and does the work without a screen. The component is still in the tree
   (components/tools/CuttingPlotter.tsx) because it is the only place a job can be inspected by
   hand if something ever goes wrong — it is simply not reachable from the tools list. */
type ToolSubTab = 'checklist' | 'spots' | 'barcode' | 'folders' | 'versions' | 'icc' | 'colors' | 'text'

const TOOL_SUB_TABS: { id: ToolSubTab; label: string; icon: React.ReactNode; needsFile: boolean }[] = [
  { id: 'checklist', label: 'Print Ready', icon: <ClipboardCheck size={12} />, needsFile: true },
  { id: 'text', label: 'Extract Text', icon: <FileText size={12} />, needsFile: true },
  { id: 'spots', label: 'Spot Colors', icon: <Droplet size={12} />, needsFile: true },
  { id: 'colors', label: 'Color Palette', icon: <Palette size={12} />, needsFile: true },
  { id: 'icc', label: 'ICC Profile', icon: <Monitor size={12} />, needsFile: true },
  { id: 'versions', label: 'Versions', icon: <History size={12} />, needsFile: true },
  { id: 'barcode', label: 'Barcode', icon: <Barcode size={12} />, needsFile: false },
  { id: 'folders', label: 'Job Folders', icon: <FolderPlus size={12} />, needsFile: false },
  /* The cutting plotter is folder-driven, not file-driven: it finds the job's
     own *.cut.json by walking up for .presskit, so it must not be greyed out
     when nothing is selected in the file list. */
]

export function InspectorPanel() {
  const { inspectorTab, setInspectorTab, selectedFile } = useAppStore()
  const [toolSubTab, setToolSubTab] = useState<ToolSubTab>('checklist')

  const hasFile = selectedFile && !selectedFile.isDirectory

  return (
    <div className="h-full flex flex-col bg-bg-secondary" style={{ minWidth: 0 }}>
      {/* Tab bar */}
      <div className="flex items-center border-b border-border flex-shrink-0">
        {TABS.map(tab => {
          const disabled = !hasFile && tab.id !== 'presscal' && tab.id !== 'tools'
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
              style={{ padding: '12px 10px', opacity: disabled ? 0.4 : 1, whiteSpace: 'nowrap' }}
              onClick={() => !disabled && setInspectorTab(tab.id)}
            >
              {tab.icon}
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto" style={{ overflowX: 'hidden', minWidth: 0 }}>
        {inspectorTab === 'metadata' && hasFile && <FileMetadata />}
        {inspectorTab === 'preflight' && hasFile && <PreflightReport />}
        {inspectorTab === 'presscal' && <PresscalPanel />}
        {inspectorTab === 'tools' && (
          <div className="flex flex-col h-full">
            {/* Tool sub-tabs */}
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 3, padding: '8px 12px',
              borderBottom: '1px solid var(--th-border)',
            }}>
              {TOOL_SUB_TABS.map(sub => {
                const disabled = sub.needsFile && !hasFile
                return (
                  <button
                    key={sub.id}
                    onClick={() => !disabled && setToolSubTab(sub.id)}
                    disabled={disabled}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                      border: 'none', cursor: disabled ? 'default' : 'pointer',
                      background: toolSubTab === sub.id ? 'var(--th-accent-subtle)' : 'transparent',
                      color: toolSubTab === sub.id ? 'var(--th-accent)' : disabled ? 'var(--th-text-muted)' : 'var(--th-text-secondary)',
                      opacity: disabled ? 0.4 : 1,
                    }}
                  >
                    {sub.icon}
                    {sub.label}
                  </button>
                )
              })}
            </div>

            {/* Tool content */}
            <div className="flex-1 overflow-y-auto">
              {toolSubTab === 'checklist' && <PrintChecklist />}
              {toolSubTab === 'text' && <ExtractTextPanel />}
              {toolSubTab === 'spots' && <SpotColorPanel />}
              {toolSubTab === 'colors' && <ColorPalette />}
              {toolSubTab === 'icc' && <IccProfileViewer />}
              {toolSubTab === 'versions' && <VersionHistory />}
              {toolSubTab === 'barcode' && <BarcodeGenerator />}
              {toolSubTab === 'folders' && <JobFolderTemplates />}
            </div>
          </div>
        )}
        {!hasFile && inspectorTab !== 'presscal' && inspectorTab !== 'tools' && (
          <div className="flex items-center justify-center h-full" style={{ color: '#475569', fontSize: 13 }}>
            Select a file
          </div>
        )}
      </div>
    </div>
  )
}
