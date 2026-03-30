import { useState, useRef, useCallback, useEffect } from 'react'
import {
  ZoomIn, ZoomOut, RotateCw, Maximize2,
  ExternalLink, FolderOpen, Eye
} from 'lucide-react'
import { useAppStore } from '@/stores/app-store'
import { FileBrowser } from '../browser/FileBrowser'
import { PdfPreview } from './PdfPreview'
import { ImagePreview } from './ImagePreview'

export function PreviewPanel() {
  const { selectedFile, preview, previewLoading } = useAppStore()

  // If no file selected, show the file browser
  if (!selectedFile || selectedFile.isDirectory) {
    return <FileBrowser />
  }

  // Loading state
  if (previewLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-bg-primary">
        <div className="flex flex-col items-center gap-2 text-text-muted">
          <div className="w-8 h-8 border-2 border-border border-t-accent rounded-full animate-spin" />
          <span className="text-xs">Loading preview...</span>
        </div>
      </div>
    )
  }

  // No preview available
  if (!preview || preview.type === 'none') {
    return (
      <div className="h-full flex items-center justify-center bg-bg-primary">
        <NoPreview file={selectedFile} />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-bg-primary">
      {/* Preview toolbar */}
      <PreviewToolbar />

      {/* Preview content */}
      <div className="flex-1 overflow-hidden">
        {preview.type === 'pdf-page' && <PdfPreview data={preview.data} />}
        {preview.type === 'image' && <ImagePreview data={preview.data} layers={preview.layers} />}
        {preview.type === 'svg' && <SvgPreview data={preview.data} />}
        {preview.type === 'font-sample' && <FontPreview data={preview.data} />}
      </div>
    </div>
  )
}

function PreviewToolbar() {
  const { selectedFile } = useAppStore()
  const [zoom, setZoom] = useState(100)

  return (
    <div className="h-8 flex items-center justify-between px-3 bg-bg-secondary border-b border-border flex-shrink-0">
      <div className="flex items-center gap-1 text-xs text-text-secondary">
        <Eye size={13} className="text-text-muted" />
        <span className="truncate max-w-[300px]">{selectedFile?.name}</span>
      </div>

      <div className="flex items-center gap-1">
        {/* Open in native app */}
        <button
          className="p-1 text-text-muted hover:text-text-primary rounded hover:bg-bg-hover"
          onClick={() => selectedFile && window.api.shell.openPath(selectedFile.path)}
          title="Open in app"
        >
          <ExternalLink size={14} />
        </button>

        {/* Show in folder */}
        <button
          className="p-1 text-text-muted hover:text-text-primary rounded hover:bg-bg-hover"
          onClick={() => selectedFile && window.api.shell.showInFolder(selectedFile.path)}
          title="Show in folder"
        >
          <FolderOpen size={14} />
        </button>
      </div>
    </div>
  )
}

function NoPreview({ file }: { file: any }) {
  return (
    <div className="flex flex-col items-center gap-3 text-text-muted">
      <div className="w-16 h-16 rounded-xl bg-bg-tertiary flex items-center justify-center">
        <Eye size={32} className="text-text-muted" />
      </div>
      <div className="text-center">
        <div className="text-sm text-text-secondary">{file.name}</div>
        <div className="text-xs mt-1">No preview available</div>
      </div>
      <button
        className="px-3 py-1.5 bg-bg-hover rounded text-xs hover:bg-bg-active transition-colors"
        onClick={() => window.api.shell.openPath(file.path)}
      >
        Open in native app
      </button>
    </div>
  )
}

function SvgPreview({ data }: { data: string }) {
  return (
    <div
      className="w-full h-full flex items-center justify-center p-4 overflow-auto"
      dangerouslySetInnerHTML={{ __html: data }}
    />
  )
}

function FontPreview({ data }: { data: string }) {
  return (
    <div
      className="w-full h-full flex items-center justify-center p-4 overflow-auto"
      dangerouslySetInnerHTML={{ __html: data }}
    />
  )
}
