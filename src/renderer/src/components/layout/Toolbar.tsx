import {
  ArrowLeft, ArrowRight, ArrowUp, RefreshCw,
  LayoutGrid, List, Scan, Settings,
  HardDrive, Cloud, Layers, RefreshCcw
} from 'lucide-react'
import { useState } from 'react'
import { useAppStore } from '@/stores/app-store'
import { Breadcrumb } from '../browser/Breadcrumb'
import { SettingsDialog } from '../tools/SettingsDialog'
import { BatchPreflightPanel } from '../batch/BatchPreflightPanel'
import { ConvertDialog } from '../convert/ConvertDialog'

export type OverlayMode = 'none' | 'batch' | 'convert'

export function Toolbar() {
  const {
    navigateBack, navigateForward, navigateUp, refreshDirectory,
    viewMode, setViewMode, source, setSource, runPreflight,
    selectedFile, pathHistory, historyIndex
  } = useAppStore()

  const [showSettings, setShowSettings] = useState(false)
  const [overlay, setOverlay] = useState<OverlayMode>('none')

  const canGoBack = historyIndex > 0
  const canGoForward = historyIndex < pathHistory.length - 1
  const canPreflight = selectedFile && !selectedFile.isDirectory

  return (
    <>
      <div className="titlebar-no-drag h-14 flex items-center gap-2 px-4 bg-bg-secondary border-b border-border flex-shrink-0">
        {/* Navigation */}
        <div className="flex items-center gap-1.5">
          <ToolbarButton icon={<ArrowLeft size={18} />} onClick={navigateBack} disabled={!canGoBack} title="Back" />
          <ToolbarButton icon={<ArrowRight size={18} />} onClick={navigateForward} disabled={!canGoForward} title="Forward" />
          <ToolbarButton icon={<ArrowUp size={18} />} onClick={navigateUp} title="Up" />
          <ToolbarButton icon={<RefreshCw size={18} />} onClick={refreshDirectory} title="Refresh" />
        </div>

        <div className="w-px h-5 bg-border mx-1" />

        {/* Source toggle */}
        <div className="flex items-center bg-bg-primary rounded-lg">
          <button
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
              source === 'local' ? 'bg-bg-active text-accent' : 'text-text-secondary hover:text-text-primary'
            }`}
            onClick={() => setSource('local')}
          >
            <HardDrive size={15} /> Local
          </button>
          <button
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
              source === 'dropbox' ? 'bg-bg-active text-accent' : 'text-text-secondary hover:text-text-primary'
            }`}
            onClick={() => setSource('dropbox')}
          >
            <Cloud size={15} /> Dropbox
          </button>
        </div>

        <div className="w-px h-5 bg-border mx-1" />

        {/* Breadcrumb */}
        <div className="flex-1 min-w-0">
          <Breadcrumb />
        </div>

        <div className="w-px h-5 bg-border mx-1" />

        {/* Actions */}
        <ToolbarButton
          icon={<Scan size={18} />}
          onClick={runPreflight}
          disabled={!canPreflight}
          title="Preflight"
          accent
        />
        <ToolbarButton
          icon={<Layers size={18} />}
          onClick={() => setOverlay(overlay === 'batch' ? 'none' : 'batch')}
          active={overlay === 'batch'}
          title="Batch Preflight"
        />
        <ToolbarButton
          icon={<RefreshCcw size={18} />}
          onClick={() => setOverlay(overlay === 'convert' ? 'none' : 'convert')}
          active={overlay === 'convert'}
          disabled={!canPreflight}
          title="Convert File"
        />

        <div className="w-px h-5 bg-border mx-1" />

        {/* View mode */}
        <div className="flex items-center gap-0.5">
          <ToolbarButton icon={<LayoutGrid size={18} />} onClick={() => setViewMode('grid')} active={viewMode === 'grid'} title="Grid" />
          <ToolbarButton icon={<List size={18} />} onClick={() => setViewMode('list')} active={viewMode === 'list'} title="List" />
        </div>

        <ToolbarButton icon={<Settings size={18} />} onClick={() => setShowSettings(true)} title="Settings" />
      </div>

      {/* Overlay panels */}
      {overlay === 'batch' && (
        <div className="absolute inset-x-0 top-[76px] bottom-6 z-40">
          <BatchPreflightPanel onClose={() => setOverlay('none')} />
        </div>
      )}
      {overlay === 'convert' && (
        <div className="absolute right-0 top-[76px] bottom-6 w-[360px] z-40 border-l border-border">
          <ConvertDialog onClose={() => setOverlay('none')} />
        </div>
      )}

      {/* Settings dialog */}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
    </>
  )
}

function ToolbarButton({ icon, onClick, disabled, active, accent, title }: {
  icon: React.ReactNode
  onClick: () => void
  disabled?: boolean
  active?: boolean
  accent?: boolean
  title?: string
}) {
  return (
    <button
      className={`p-2.5 rounded-lg transition-colors ${
        disabled
          ? 'text-text-muted cursor-not-allowed'
          : active
            ? 'text-accent bg-bg-active'
            : accent
              ? 'text-accent hover:bg-bg-hover'
              : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
      }`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {icon}
    </button>
  )
}
