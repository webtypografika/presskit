import { useState, useEffect, useCallback } from 'react'
import {
  Folder, FileText, Image, Type, FileSpreadsheet,
  Archive, File, Layers
} from 'lucide-react'
import { clsx } from 'clsx'
import type { FileEntry, FileType } from '@/lib/file-types'
import { formatFileSize, getFileTypeColor, getFileTypeLabel } from '@/lib/file-types'
import type { ViewMode } from '@/stores/app-store'
import { useAppStore } from '@/stores/app-store'
import { ContextMenu } from './ContextMenu'

function FileTypeIcon({ type, size = 32 }: { type: FileType; size?: number }) {
  const color = getFileTypeColor(type)
  const iconProps = { size, color, strokeWidth: 1.5 }

  switch (type) {
    case 'folder': return <Folder {...iconProps} fill={color} fillOpacity={0.15} />
    case 'pdf': return <FileText {...iconProps} />
    case 'ai': return <Layers {...iconProps} />
    case 'psd': return <Layers {...iconProps} />
    case 'eps': return <FileText {...iconProps} />
    case 'indd': return <FileText {...iconProps} />
    case 'tiff': case 'png': case 'jpg': case 'svg': case 'raw':
      return <Image {...iconProps} />
    case 'font': return <Type {...iconProps} />
    case 'spreadsheet': return <FileSpreadsheet {...iconProps} />
    case 'archive': return <Archive {...iconProps} />
    default: return <File {...iconProps} />
  }
}

function FileThumbnail({ file, size }: { file: FileEntry; size: number }) {
  const [thumb, setThumb] = useState<string | null>(null)

  useEffect(() => {
    if (file.isDirectory) return
    let cancelled = false

    window.api.preview.thumbnail(file.path, size)
      .then(data => { if (!cancelled && data) setThumb(data) })
      .catch(() => {})

    return () => { cancelled = true }
  }, [file.path, file.isDirectory, size])

  if (file.isDirectory || !thumb) {
    return (
      <div className="flex items-center justify-center w-full h-full">
        <FileTypeIcon type={file.type} size={file.isDirectory ? size * 0.5 : size * 0.4} />
      </div>
    )
  }

  return (
    <img
      src={thumb}
      alt={file.name}
      className="w-full h-full object-contain"
      draggable={false}
    />
  )
}

export function FileGrid({ files, viewMode, selectedFile, onSelect, onOpen }: {
  files: FileEntry[]
  viewMode: ViewMode
  selectedFile: FileEntry | null
  onSelect: (file: FileEntry) => void
  onOpen: (file: FileEntry) => void
}) {
  const thumbnailSize = useAppStore(s => s.thumbnailSize)
  const { runPreflight, setInspectorTab } = useAppStore()
  const [ctxMenu, setCtxMenu] = useState<{ file: FileEntry; x: number; y: number } | null>(null)

  const handleContextMenu = useCallback((e: React.MouseEvent, file: FileEntry) => {
    e.preventDefault()
    onSelect(file)
    setCtxMenu({ file, x: e.clientX, y: e.clientY })
  }, [onSelect])

  const handleCtxAction = useCallback((action: string) => {
    const file = ctxMenu?.file
    setCtxMenu(null)
    if (!file) return

    switch (action) {
      case 'preview':
        onSelect(file)
        break
      case 'openInApp':
        window.api.shell.openPath(file.path)
        break
      case 'showInFolder':
        window.api.shell.showInFolder(file.path)
        break
      case 'preflight':
        onSelect(file)
        setTimeout(runPreflight, 100)
        break
      case 'linkQuote':
      case 'linkJob':
      case 'linkCustomer':
      case 'sendEmail':
        onSelect(file)
        setInspectorTab('presscal')
        break
      case 'copyPath':
        navigator.clipboard.writeText(file.path)
        break
      case 'copyName':
        navigator.clipboard.writeText(file.name)
        break
      case 'bookmark':
        if (file.isDirectory) window.api.settings.addBookmark(file.path)
        break
    }
  }, [ctxMenu, onSelect, runPreflight, setInspectorTab])

  if (viewMode === 'list') {
    return (
      <div className="h-full overflow-y-auto">
        {/* List header */}
        <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-1 bg-bg-tertiary border-b border-border text-sm text-text-muted font-medium uppercase tracking-wider">
          <span className="w-6" />
          <span className="flex-1">Name</span>
          <span className="w-20 text-right">Size</span>
          <span className="w-20 text-center">Type</span>
          <span className="w-32 text-right">Modified</span>
        </div>

        {/* List items */}
        {files.map(file => (
          <div
            key={file.path}
            className={clsx(
              'flex items-center gap-2 px-3 py-1 cursor-pointer transition-colors',
              selectedFile?.path === file.path
                ? 'bg-bg-active text-text-primary'
                : 'hover:bg-bg-hover text-text-secondary'
            )}
            onClick={() => onSelect(file)}
            onDoubleClick={() => onOpen(file)}
            onContextMenu={(e) => handleContextMenu(e, file)}
          >
            <span className="w-6 flex-shrink-0 flex justify-center">
              <FileTypeIcon type={file.type} size={16} />
            </span>
            <span className="flex-1 truncate text-xs">{file.name}</span>
            <span className="w-20 text-right text-sm text-text-muted">
              {file.isDirectory ? '' : formatFileSize(file.size)}
            </span>
            <span
              className="w-20 text-center text-sm"
              style={{ color: getFileTypeColor(file.type) }}
            >
              {getFileTypeLabel(file.type)}
            </span>
            <span className="w-32 text-right text-sm text-text-muted">
              {file.modified ? new Date(file.modified).toLocaleDateString('el-GR') : ''}
            </span>
          </div>
        ))}

        {/* Context menu (list view) */}
        {ctxMenu && (
          <ContextMenu
            file={ctxMenu.file}
            x={ctxMenu.x}
            y={ctxMenu.y}
            onClose={() => setCtxMenu(null)}
            onAction={handleCtxAction}
          />
        )}
      </div>
    )
  }

  // Grid view
  const cellSize = thumbnailSize + 40

  return (
    <div className="h-full overflow-y-auto p-3">
      <div
        className="grid gap-2"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${cellSize}px, 1fr))`
        }}
      >
        {files.map(file => (
          <div
            key={file.path}
            className={clsx(
              'flex flex-col items-center rounded-lg cursor-pointer transition-colors p-2',
              selectedFile?.path === file.path
                ? 'bg-bg-active ring-1 ring-accent/40'
                : 'hover:bg-bg-hover'
            )}
            onClick={() => onSelect(file)}
            onDoubleClick={() => onOpen(file)}
            onContextMenu={(e) => handleContextMenu(e, file)}
          >
            {/* Thumbnail */}
            <div
              className="rounded bg-bg-primary flex items-center justify-center overflow-hidden"
              style={{ width: thumbnailSize, height: thumbnailSize }}
            >
              <FileThumbnail file={file} size={thumbnailSize} />
            </div>

            {/* File name */}
            <div className="mt-1.5 w-full text-center">
              <div className="text-sm leading-tight truncate text-text-primary px-1">
                {file.name}
              </div>
              {!file.isDirectory && (
                <div className="text-xs mt-0.5" style={{ color: getFileTypeColor(file.type) }}>
                  {getFileTypeLabel(file.type)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          file={ctxMenu.file}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          onAction={handleCtxAction}
        />
      )}
    </div>
  )
}
