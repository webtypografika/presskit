import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Folder, FileText, Image, Type, FileSpreadsheet,
  Archive, File, Layers
} from 'lucide-react'
import { clsx } from 'clsx'
import type { FileEntry, FileType } from '@/lib/file-types'
import { formatFileSize, getFileTypeColor, getFileTypeLabel } from '@/lib/file-types'
import { renderPdfThumbnail } from '@/lib/pdf-thumbnail'
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

    const isPdf = file.type === 'pdf' || file.type === 'ai'

    if (isPdf) {
      // Render PDF/AI thumbnails client-side via pdf.js
      renderPdfThumbnail(file.path, size)
        .then(data => { if (!cancelled && data) setThumb(data) })
        .catch(() => {})
    } else {
      // All other files via main process (sharp etc.)
      window.api.preview.thumbnail(file.path, size)
        .then(data => { if (!cancelled && data) setThumb(data) })
        .catch(() => {})
    }

    return () => { cancelled = true }
  }, [file.path, file.isDirectory, file.type, size])

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
  const { runPreflight, setInspectorTab, toggleFileSelection, selectedFiles, clearSelection, selectFileRange, copyFiles, cutFiles, pasteFiles } = useAppStore()
  const [ctxMenu, setCtxMenu] = useState<{ file: FileEntry; x: number; y: number } | null>(null)
  const lastClickedIndexRef = useRef<number>(-1)

  const handleClick = useCallback((e: React.MouseEvent, file: FileEntry, index: number) => {
    if (e.shiftKey && lastClickedIndexRef.current >= 0) {
      // Shift+click: select range
      const start = Math.min(lastClickedIndexRef.current, index)
      const end = Math.max(lastClickedIndexRef.current, index)
      selectFileRange(files.slice(start, end + 1))
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl+click: toggle single
      toggleFileSelection(file)
      lastClickedIndexRef.current = index
    } else {
      // Normal click: select single, clear multi-selection
      selectFileRange([file])
      onSelect(file)
      lastClickedIndexRef.current = index
    }
  }, [files, toggleFileSelection, selectFileRange, clearSelection, onSelect])

  const handleContextMenu = useCallback((e: React.MouseEvent, file: FileEntry) => {
    e.preventDefault()
    onSelect(file)
    setCtxMenu({ file, x: e.clientX, y: e.clientY })
  }, [onSelect])

  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const { refreshDirectory } = useAppStore()

  const getDragPaths = useCallback((file: FileEntry) => {
    return selectedFiles.length > 1 && selectedFiles.some(f => f.path === file.path)
      ? selectedFiles.map(f => f.path)
      : [file.path]
  }, [selectedFiles])

  const dragPathsRef = useRef<string[]>([])

  const handleDragStart = useCallback((e: React.DragEvent, file: FileEntry) => {
    const paths = getDragPaths(file)
    dragPathsRef.current = paths
    // HTML5 drag for internal drops
    e.dataTransfer.setData('application/x-filehelper-paths', JSON.stringify(paths))
    e.dataTransfer.effectAllowed = 'copyMove'
  }, [getDragPaths])

  // Native drag-out when mouse leaves the window
  useEffect(() => {
    const handleDragLeaveWindow = (e: DragEvent) => {
      // Only fire native drag when leaving the app window entirely
      if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
        if (dragPathsRef.current.length > 0) {
          window.api.drag.start(dragPathsRef.current)
        }
      }
    }
    window.addEventListener('dragleave', handleDragLeaveWindow)
    return () => window.removeEventListener('dragleave', handleDragLeaveWindow)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, file: FileEntry) => {
    if (!file.isDirectory) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move'
    setDropTarget(file.path)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDropTarget(null)
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent, targetFolder: FileEntry) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)
    if (!targetFolder.isDirectory) return

    const data = e.dataTransfer.getData('application/x-filehelper-paths')
    if (!data) return

    const paths: string[] = JSON.parse(data)
    // Don't drop into itself
    const validPaths = paths.filter(p => p !== targetFolder.path && !targetFolder.path.startsWith(p + '/') && !targetFolder.path.startsWith(p + '\\'))
    if (!validPaths.length) return

    if (e.ctrlKey) {
      await window.api.fs.copy(validPaths, targetFolder.path)
    } else {
      await window.api.fs.move(validPaths, targetFolder.path)
    }
    refreshDirectory()
  }, [refreshDirectory])

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
      case 'copyFile':
        onSelect(file)
        setTimeout(copyFiles, 0)
        break
      case 'cutFile':
        onSelect(file)
        setTimeout(cutFiles, 0)
        break
      case 'pasteFile':
        pasteFiles()
        break
      case 'delete':
        if (confirm(`Διαγραφή "${file.name}";`)) {
          window.api.fs.trash([file.path]).then(() => refreshDirectory())
        }
        break
    }
  }, [ctxMenu, onSelect, runPreflight, setInspectorTab, refreshDirectory, copyFiles, cutFiles, pasteFiles])

  if (viewMode === 'list') {
    return (
      <div className="h-full overflow-y-auto">
        {/* List header */}
        <div className="sticky top-0 z-10 flex items-center gap-2 bg-bg-tertiary border-b border-border text-sm text-text-muted font-medium uppercase tracking-wider" style={{ padding: '10px 20px' }}>
          <span className="w-6" />
          <span className="flex-1">Name</span>
          <span className="w-20 text-right">Size</span>
          <span className="w-20 text-center">Type</span>
          <span className="w-32 text-right">Modified</span>
        </div>

        {/* List items */}
        {files.map((file, index) => (
          <div
            key={file.path}
            className={clsx(
              'flex items-center gap-2 cursor-pointer transition-colors',
              (selectedFile?.path === file.path || selectedFiles.some(f => f.path === file.path))
                ? 'text-text-primary'
                : 'hover:bg-bg-hover text-text-secondary'
            )}
            draggable
            onDragStart={(e) => handleDragStart(e, file)}
            onDragOver={(e) => handleDragOver(e, file)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, file)}
            onClick={(e) => handleClick(e, file, index)}
            onDoubleClick={() => onOpen(file)}
            onContextMenu={(e) => handleContextMenu(e, file)}
            style={{
              padding: '8px 20px',
              borderLeft: (selectedFile?.path === file.path || selectedFiles.some(f => f.path === file.path))
                ? '2px solid #f58220' : '2px solid transparent',
              background: dropTarget === file.path
                ? 'rgba(245,130,32,0.15)'
                : (selectedFile?.path === file.path || selectedFiles.some(f => f.path === file.path))
                  ? 'rgba(245,130,32,0.08)' : undefined,
              outline: dropTarget === file.path ? '2px dashed #f58220' : undefined,
              outlineOffset: -2,
            }}
          >
            <span className="w-6 flex-shrink-0 flex justify-center" style={{ position: 'relative' }}>
              <FileTypeIcon type={file.type} size={16} />
              {file.cloudStatus === 'cloud' && (
                <span style={{ position: 'absolute', bottom: -2, right: -2, fontSize: 7, color: '#3b82f6' }}>☁</span>
              )}
            </span>
            <span className="flex-1 truncate text-xs">
              {file.name}
              {file.cloudStatus === 'cloud' && (
                <span style={{ marginLeft: 6, fontSize: 10, color: '#3b82f6', fontWeight: 500 }}>cloud</span>
              )}
            </span>
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
  const cellSize = thumbnailSize + 24

  return (
    <div className="h-full overflow-y-auto" style={{ padding: 10 }}>
      <div
        className="grid"
        style={{
          gap: 6,
          gridTemplateColumns: `repeat(auto-fill, minmax(${cellSize}px, 1fr))`
        }}
      >
        {files.map((file, index) => (
          <div
            key={file.path}
            className={clsx(
              'flex flex-col items-center rounded-lg cursor-pointer transition-colors'
            )}
            draggable
            onDragStart={(e) => handleDragStart(e, file)}
            onDragOver={(e) => handleDragOver(e, file)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, file)}
            onClick={(e) => handleClick(e, file, index)}
            onDoubleClick={() => onOpen(file)}
            onContextMenu={(e) => handleContextMenu(e, file)}
            style={{
              padding: 4,
              border: dropTarget === file.path
                ? '2px dashed #f58220'
                : (selectedFile?.path === file.path || selectedFiles.some(f => f.path === file.path))
                  ? '1px solid #f58220' : '1px solid transparent',
              background: dropTarget === file.path
                ? 'rgba(245,130,32,0.15)'
                : selectedFiles.some(f => f.path === file.path)
                  ? 'rgba(245,130,32,0.08)' : 'transparent',
              borderRadius: 10,
            }}
          >
            {/* Thumbnail */}
            <div
              className="rounded flex items-center justify-center overflow-hidden"
              style={{ width: thumbnailSize, height: thumbnailSize, position: 'relative' }}
            >
              <FileThumbnail file={file} size={thumbnailSize} />
              {file.cloudStatus && (
                <CloudBadge status={file.cloudStatus} />
              )}
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

function CloudBadge({ status }: { status: 'local' | 'cloud' | 'syncing' }) {
  if (status === 'local') {
    return (
      <span style={{
        position: 'absolute', bottom: 4, right: 4,
        width: 16, height: 16, borderRadius: '50%',
        background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, color: '#22c55e',
      }} title="Local (synced)">
        ✓
      </span>
    )
  }
  if (status === 'cloud') {
    return (
      <span style={{
        position: 'absolute', bottom: 4, right: 4,
        width: 16, height: 16, borderRadius: '50%',
        background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, color: '#3b82f6',
      }} title="Cloud only">
        ☁
      </span>
    )
  }
  return null
}
