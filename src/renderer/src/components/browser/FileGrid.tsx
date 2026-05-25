import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Folder, FileText, Image, Type, FileSpreadsheet,
  Archive, File, Layers, FolderPlus, Clipboard, ArrowUp, ArrowDown
} from 'lucide-react'
import { clsx } from 'clsx'
import type { FileEntry, FileType } from '@/lib/file-types'
import { formatFileSize, getFileTypeColor, getFileTypeLabel } from '@/lib/file-types'
import { renderPdfThumbnail } from '@/lib/pdf-thumbnail'
import type { ViewMode } from '@/stores/app-store'
import { useDialogStore } from '@/stores/dialog-store'

// Helper: get native file paths from a drop event (Electron 33+ compatible)
const getDropPaths = (e: React.DragEvent): string[] =>
  Array.from(e.dataTransfer.files).map(f => window.api.fs.getFilePath(f)).filter(Boolean)

// Shared Intl formatter — avoid creating a new one per row on every render
const dateFormatter = new Intl.DateTimeFormat('el-GR', {
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
})

// ─── Thumbnail queues ────────────────────────────────────────────────
// Image thumbnails run in the main process (sharp) — fast, can run 3 at once.
// PDF thumbnails render on the renderer thread (pdf.js canvas) — heavy, run 1
// at a time with a small yield between renders to keep the UI responsive.
const IMG_CONCURRENCY = 3
let imgRunning = 0
const imgQueue: Array<() => void> = []

function enqueueThumb(fn: () => Promise<any>): void {
  const run = () => {
    imgRunning++
    fn().finally(() => {
      imgRunning--
      // Small yield so the UI thread can breathe between thumbnail batches
      if (imgQueue.length > 0) setTimeout(() => imgQueue.shift()!(), 16)
    })
  }
  if (imgRunning < IMG_CONCURRENCY) run()
  else imgQueue.push(run)
}

let pdfRunning = 0
const pdfQueue: Array<() => void> = []

function enqueuePdfThumb(fn: () => Promise<any>): void {
  const run = () => {
    pdfRunning++
    fn().finally(() => {
      pdfRunning--
      // Yield before starting next PDF render so the UI thread can breathe
      if (pdfQueue.length > 0) setTimeout(() => pdfQueue.shift()!(), 50)
    })
  }
  if (pdfRunning < 1) run()
  else pdfQueue.push(run)
}

// Max file size for PDF thumbnail rendering (bytes). Larger files just show
// the PDF icon — reading a 100 MB print file into the renderer for a tiny
// thumbnail isn't worth the freeze.
const PDF_THUMB_MAX_SIZE = 20 * 1024 * 1024 // 20 MB
import { useAppStore } from '@/stores/app-store'
import { useShallow } from 'zustand/react/shallow'
import { ContextMenu } from './ContextMenu'
import { dragState } from '@/lib/drag-state'

// Adobe-style badge icon: rounded square with 2-letter abbreviation
function AdobeBadge({ label, bg, size }: { label: string; bg: string; size: number }) {
  const r = Math.round(size * 0.18)
  const fontSize = size <= 18 ? 9 : size <= 24 ? 11 : Math.round(size * 0.44)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <rect x={0} y={0} width={size} height={size} rx={r} ry={r} fill={bg} />
      <text
        x={size / 2} y={size / 2}
        textAnchor="middle" dominantBaseline="central"
        fill="#fff" fontFamily="system-ui, sans-serif" fontWeight={700} fontSize={fontSize}
      >
        {label}
      </text>
    </svg>
  )
}

function FileTypeIcon({ type, size = 32 }: { type: FileType; size?: number }) {
  const color = getFileTypeColor(type)
  const iconProps = { size, color, strokeWidth: 1.5 }

  switch (type) {
    case 'folder': return <Folder {...iconProps} fill={color} fillOpacity={0.15} />
    case 'pdf': return <AdobeBadge label="Pdf" bg="#e2574c" size={size} />
    case 'ai': return <AdobeBadge label="Ai" bg="#ff7c00" size={size} />
    case 'psd': return <AdobeBadge label="Ps" bg="#31a8ff" size={size} />
    case 'eps': return <AdobeBadge label="Ep" bg="#ff7c00" size={size} />
    case 'indd': return <AdobeBadge label="Id" bg="#ff3366" size={size} />
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
      // Skip PDF thumbnail for large files — rendering a 100 MB print-ready
      // PDF on the renderer thread just for a grid icon isn't worth the freeze.
      if (file.size > PDF_THUMB_MAX_SIZE) return
      enqueuePdfThumb(async () => {
        if (cancelled) return
        try {
          const data = await renderPdfThumbnail(file.path, size, file.modified)
          if (!cancelled && data) setThumb(data)
        } catch {}
      })
    } else {
      enqueueThumb(async () => {
        if (cancelled) return
        try {
          const data = await window.api.preview.thumbnail(file.path, size)
          if (!cancelled && data) setThumb(data)
        } catch {}
      })
    }

    return () => { cancelled = true }
  }, [file.path, file.isDirectory, file.type, size, file.modified])

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
  const selectedFiles = useAppStore(s => s.selectedFiles)
  const pickedFiles = useAppStore(s => s.pickedFiles)
  const newFolderPending = useAppStore(s => s.newFolderPending)
  const clipboard = useAppStore(s => s.clipboard)
  const {
    runPreflight, setInspectorTab, selectFile, requestConvert,
    toggleFileSelection, clearSelection,
    selectFileRange, copyFiles, cutFiles, pasteFiles, togglePick,
    requestNewFolder, clearNewFolder, createNewFolder
  } = useAppStore(useShallow(s => ({
    runPreflight: s.runPreflight,
    setInspectorTab: s.setInspectorTab,
    selectFile: s.selectFile,
    requestConvert: s.requestConvert,
    toggleFileSelection: s.toggleFileSelection,
    clearSelection: s.clearSelection,
    selectFileRange: s.selectFileRange,
    copyFiles: s.copyFiles,
    cutFiles: s.cutFiles,
    pasteFiles: s.pasteFiles,
    togglePick: s.togglePick,
    requestNewFolder: s.requestNewFolder,
    clearNewFolder: s.clearNewFolder,
    createNewFolder: s.createNewFolder,
  })))
  const showAlert = useDialogStore(s => s.showAlert)
  const showConfirm = useDialogStore(s => s.showConfirm)
  const [ctxMenu, setCtxMenu] = useState<{ file: FileEntry; x: number; y: number } | null>(null)
  const [bgCtxMenu, setBgCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const refreshDirectory = useAppStore(s => s.refreshDirectory)
  const lastClickedIndexRef = useRef<number>(-1)

  // F2 to rename selected file
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2' && selectedFile && !renamingPath) {
        e.preventDefault()
        setRenamingPath(selectedFile.path)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedFile, renamingPath])

  const handleRename = useCallback(async (file: FileEntry, newName: string) => {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === file.name) {
      setRenamingPath(null)
      return
    }
    const result = await window.api.fs.rename(file.path, trimmed)
    setRenamingPath(null)
    if (!result.ok) {
      showAlert(result.error || 'Αποτυχία μετονομασίας')
    }
    setTimeout(() => refreshDirectory(), 200)
  }, [refreshDirectory])

  // Right-click on empty space (background)
  const handleBgContextMenu = useCallback((e: React.MouseEvent) => {
    // Only trigger if the click target is the container itself, not a file item
    if (e.target === e.currentTarget || (e.currentTarget as HTMLElement).contains(e.target as Node)) {
      // Check if click was on a file item - if so, let the file context menu handle it
      const target = e.target as HTMLElement
      if (target.closest('[data-file-item]')) return
      e.preventDefault()
      clearSelection()
      setBgCtxMenu({ x: e.clientX, y: e.clientY })
    }
  }, [clearSelection])

  // ─── Sort state (list view) ──────────────────────────────────────
  type SortKey = 'name' | 'type' | 'modified' | 'size'
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortAsc, setSortAsc] = useState(true)
  const toggleSort = useCallback((key: SortKey) => {
    if (sortKey === key) setSortAsc(prev => !prev)
    else { setSortKey(key); setSortAsc(key === 'name') }
  }, [sortKey])

  const sortedFiles = useMemo(() => {
    const sorted = [...files]
    sorted.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      let cmp = 0
      switch (sortKey) {
        case 'name': cmp = a.name.localeCompare(b.name); break
        case 'type': cmp = (a.type || '').localeCompare(b.type || '') || a.name.localeCompare(b.name); break
        case 'modified': cmp = new Date(a.modified || 0).getTime() - new Date(b.modified || 0).getTime(); break
        case 'size': cmp = (a.size || 0) - (b.size || 0); break
      }
      return sortAsc ? cmp : -cmp
    })
    return sorted
  }, [files, sortKey, sortAsc])

  const handleClick = useCallback((e: React.MouseEvent, file: FileEntry, index: number) => {
    // Use sortedFiles for list view so shift-click ranges match visual order
    const visibleFiles = viewMode === 'list' ? sortedFiles : files
    if (e.shiftKey && lastClickedIndexRef.current >= 0) {
      // Shift+click: select range
      const start = Math.min(lastClickedIndexRef.current, index)
      const end = Math.max(lastClickedIndexRef.current, index)
      selectFileRange(visibleFiles.slice(start, end + 1))
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
  }, [files, sortedFiles, viewMode, toggleFileSelection, selectFileRange, onSelect])

  const handleContextMenu = useCallback((e: React.MouseEvent, file: FileEntry) => {
    e.preventDefault()
    e.stopPropagation()
    // If the right-clicked file is already in multi-selection, keep the selection intact
    // Otherwise select just this file (same as single-click)
    const isInSelection = selectedFiles.some(f => f.path === file.path)
    if (!isInSelection) {
      selectFileRange([file])
      onSelect(file)
    }
    setBgCtxMenu(null)
    setCtxMenu({ file, x: e.clientX, y: e.clientY })
  }, [onSelect, selectedFiles, selectFileRange])

  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const getDragPaths = useCallback((file: FileEntry) => {
    return selectedFiles.length > 1 && selectedFiles.some(f => f.path === file.path)
      ? selectedFiles.map(f => f.path)
      : [file.path]
  }, [selectedFiles])

  // ─── Custom drag: mousedown/mousemove/mouseup ─────────────────────
  // Internal moves use custom tracking; when cursor leaves the window,
  // we switch to native OLE drag for external apps (Illustrator, etc.)
  const customDragRef = useRef<{
    file: FileEntry
    paths: string[]
    startX: number
    startY: number
    active: boolean        // drag threshold exceeded
    nativeStarted: boolean // handed off to native OLE drag
  } | null>(null)
  const [dragGhost, setDragGhost] = useState<{ x: number; y: number; name: string; count: number } | null>(null)

  const handleItemMouseDown = useCallback((e: React.MouseEvent, file: FileEntry) => {
    // Only left button, ignore on inputs and context menus
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('input, button, .pick-badge')) return

    const paths = getDragPaths(file)
    customDragRef.current = {
      file, paths,
      startX: e.clientX, startY: e.clientY,
      active: false, nativeStarted: false,
    }
  }, [getDragPaths])

  useEffect(() => {
    const THRESHOLD = 6

    const onMouseMove = (e: MouseEvent) => {
      const drag = customDragRef.current
      if (!drag || drag.nativeStarted) return

      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY

      // Activation threshold
      if (!drag.active) {
        if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return
        drag.active = true
        dragState.set(drag.paths)
      }

      // Check if cursor left the window → switch to native OLE drag
      if (e.clientX <= 0 || e.clientY <= 0 ||
          e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
        drag.nativeStarted = true
        setDragGhost(null)
        setDropTarget(null)
        window.api.drag.start(drag.paths).finally(() => {
          dragState.clear()
          customDragRef.current = null
        })
        return
      }

      // Show ghost
      setDragGhost({
        x: e.clientX, y: e.clientY,
        name: drag.file.name,
        count: drag.paths.length,
      })

      // Hit-test folders for drop target. Skip the source folder(s) —
      // highlighting them looks like "cannot drop" to the user and is confusing
      // because they haven't moved the cursor off the source yet.
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const folderEl = el?.closest('[data-folder-path]') as HTMLElement | null
      const path = folderEl?.dataset.folderPath || null
      const isSourceOrDescendant = path && drag.paths.some(p =>
        p === path || path.startsWith(p + '/') || path.startsWith(p + '\\')
      )
      setDropTarget(isSourceOrDescendant ? null : path)
    }

    const onMouseUp = async (e: MouseEvent) => {
      const drag = customDragRef.current
      if (!drag) return
      customDragRef.current = null
      setDragGhost(null)

      if (!drag.active || drag.nativeStarted) {
        dragState.clear()
        setDropTarget(null)
        return
      }

      // Check if dropped on a folder
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const folderEl = el?.closest('[data-folder-path]') as HTMLElement | null
      const targetPath = folderEl?.dataset.folderPath

      setDropTarget(null)
      dragState.clear()

      if (!targetPath) return

      const validPaths = drag.paths.filter(p =>
        p !== targetPath &&
        !targetPath.startsWith(p + '/') &&
        !targetPath.startsWith(p + '\\')
      )
      if (!validPaths.length) return

      try {
        const results = e.ctrlKey
          ? await window.api.fs.copy(validPaths, targetPath)
          : await window.api.fs.move(validPaths, targetPath)
        refreshDirectory()

        const failures = (results || []).filter((r: any) => !r.ok)
        if (failures.length > 0) {
          const list = failures.map((f: any) =>
            `• ${f.source.split(/[\\/]/).pop()}: ${f.error || 'άγνωστο σφάλμα'}`
          ).join('\n')
          showAlert(
            `${e.ctrlKey ? 'Αντιγραφή' : 'Μετακίνηση'} απέτυχε για ${failures.length} αρχεί${failures.length === 1 ? 'ο' : 'α'}:\n\n${list}\n\n` +
            `Πιθανή αιτία: ανοιχτό σε άλλη εφαρμογή ή κλειδωμένο από Dropbox/antivirus.`
          )
        }
      } catch (err) {
        showAlert(`Drop failed: ${(err as any)?.message || err}`)
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [refreshDirectory])

  // External file drops (from Explorer/other apps INTO PressKit) — keep HTML5 handlers
  const handleExternalDragOver = useCallback((e: React.DragEvent, file: FileEntry) => {
    if (!file.isDirectory) return
    // Only handle actual external drops (not our custom drag)
    if (dragState.isActive()) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setDropTarget(file.path)
  }, [])

  const handleExternalDragLeave = useCallback((e: React.DragEvent) => {
    if (dragState.isActive()) return
    e.preventDefault()
    setDropTarget(null)
  }, [])

  const handleExternalDrop = useCallback(async (e: React.DragEvent, targetFolder: FileEntry) => {
    if (dragState.isActive()) return
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)

    // If dropped on a file (not folder), copy to current directory instead
    const destDir = targetFolder.isDirectory ? targetFolder.path : useAppStore.getState().currentPath
    if (!destDir) return

    const sourcePaths = getDropPaths(e)
    if (!sourcePaths.length) return

    try {
      const results = await window.api.fs.copy(sourcePaths, destDir)
      const failed = results.filter((r: any) => !r.ok)
      if (failed.length > 0) {
        const list = failed.map((f: any) =>
          `• ${f.source.split(/[\\/]/).pop()}: ${f.error || 'άγνωστο σφάλμα'}`
        ).join('\n')
        showAlert(`Αντιγραφή απέτυχε για ${failed.length} αρχεί${failed.length === 1 ? 'ο' : 'α'}:\n\n${list}`)
      }
      refreshDirectory()
    } catch {}
  }, [refreshDirectory])

  const handleBgDrop = useCallback(async (e: React.DragEvent) => {
    if (dragState.isActive()) return
    e.preventDefault()
    e.stopPropagation()

    const { currentPath } = useAppStore.getState()
    if (!currentPath) return

    const sourcePaths = getDropPaths(e)
    if (!sourcePaths.length) return

    try {
      const results = await window.api.fs.copy(sourcePaths, currentPath)
      const failed = results.filter((r: any) => !r.ok)
      if (failed.length > 0) {
        const list = failed.map((f: any) =>
          `• ${f.source.split(/[\\/]/).pop()}: ${f.error || 'άγνωστο σφάλμα'}`
        ).join('\n')
        showAlert(`Αντιγραφή απέτυχε για ${failed.length} αρχεί${failed.length === 1 ? 'ο' : 'α'}:\n\n${list}`)
      }
      refreshDirectory()
    } catch {}
  }, [refreshDirectory])

  const handleBgDragOver = useCallback((e: React.DragEvent) => {
    if (dragState.isActive()) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleCtxAction = useCallback((action: string) => {
    const file = ctxMenu?.file
    setCtxMenu(null)
    if (!file) return

    switch (action) {
      case 'togglePick':
        togglePick(file.name)
        break
      case 'rename':
        setRenamingPath(file.path)
        break
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
      case 'convert':
        selectFile(file)
        setTimeout(() => requestConvert(), 50)
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
      case 'newFolder':
        requestNewFolder()
        break
      case 'extractZip': {
        window.api.fs.extractZip(file.path).then((result) => {
          if (!result.ok) {
            showAlert(`Αποτυχία αποσυμπίεσης: ${result.error}`)
          }
          setTimeout(() => refreshDirectory(), 300)
        })
        break
      }
      case 'delete': {
        // Collect all files to delete: multi-selected or just the right-clicked one
        const filesToDelete = selectedFiles.length > 1 && selectedFiles.some(f => f.path === file.path)
          ? selectedFiles
          : [file]
        const names = filesToDelete.length === 1
          ? `"${filesToDelete[0].name}"`
          : `${filesToDelete.length} αρχεία`
        showConfirm(`Διαγραφή ${names};`).then((ok) => {
          if (!ok) return
          window.api.fs.trash(filesToDelete.map(f => f.path)).then((results) => {
            const failed = results.filter((r: any) => !r.ok)
            if (failed.length > 0) {
              showAlert(`Αποτυχία διαγραφής ${failed.length} αρχείων:\n${failed.map((f: any) => f.error).join('\n')}`)
            }
            clearSelection()
            setTimeout(() => refreshDirectory(), 200)
          })
        })
        break
      }
    }
  }, [ctxMenu, onSelect, selectFile, requestConvert, runPreflight, setInspectorTab, refreshDirectory, copyFiles, cutFiles, pasteFiles, selectedFiles, clearSelection, togglePick, requestNewFolder, showAlert, showConfirm])

  // ─── Resizable column widths (list view) ─────────────────────────
  const colWidthsRef = useRef({ type: 80, date: 100, size: 80 })
  const [colWidths, setColWidths] = useState({ type: 80, date: 100, size: 80 })

  const onResizeStart = useCallback((e: React.MouseEvent, col: 'type' | 'date' | 'size') => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = colWidthsRef.current[col]

    const onMove = (ev: MouseEvent) => {
      // Handle is on the LEFT edge: drag left = column wider (negative delta = bigger)
      const delta = ev.clientX - startX
      const newW = Math.max(40, startW - delta)
      colWidthsRef.current = { ...colWidthsRef.current, [col]: newW }
      setColWidths({ ...colWidthsRef.current })
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  if (viewMode === 'list') {
    const colTemplate = `8px 22px 1fr ${colWidths.type}px ${colWidths.date}px ${colWidths.size}px`

    return (
      <div className="h-full overflow-y-auto" onContextMenu={handleBgContextMenu} onDrop={handleBgDrop} onDragOver={handleBgDragOver}>
        {/* List header */}
        <div
          className="sticky top-0 z-10 bg-bg-tertiary border-b border-border text-text-muted font-medium uppercase tracking-wider select-none"
          style={{ display: 'grid', gridTemplateColumns: colTemplate, alignItems: 'center', padding: '8px 16px', fontSize: 11 }}
        >
          <span />
          <span />
          <SortableHeader label="Name" sortKey="name" currentKey={sortKey} asc={sortAsc} onSort={toggleSort} />
          <ResizableHeader label="Type" onResize={(e) => onResizeStart(e, 'type')} align="center" sortKey="type" currentKey={sortKey} asc={sortAsc} onSort={toggleSort} />
          <ResizableHeader label="Modified" onResize={(e) => onResizeStart(e, 'date')} align="center" sortKey="modified" currentKey={sortKey} asc={sortAsc} onSort={toggleSort} />
          <ResizableHeader label="Size" onResize={(e) => onResizeStart(e, 'size')} align="right" sortKey="size" currentKey={sortKey} asc={sortAsc} onSort={toggleSort} />
        </div>

        {/* List items */}
        {sortedFiles.map((file, index) => {
          const isSelected = selectedFile?.path === file.path || selectedFiles.some(f => f.path === file.path)
          return (
            <div
              key={file.path}
              data-file-item
              className={clsx(
                'cursor-pointer',
                isSelected ? 'text-text-primary' : 'hover:bg-bg-hover text-text-secondary'
              )}
              onMouseDown={(e) => handleItemMouseDown(e, file)}
              onDragOver={(e) => handleExternalDragOver(e, file)}
              onDragLeave={handleExternalDragLeave}
              onDrop={(e) => handleExternalDrop(e, file)}
              onClick={(e) => handleClick(e, file, index)}
              onDoubleClick={() => onOpen(file)}
              onContextMenu={(e) => handleContextMenu(e, file)}
              {...(file.isDirectory ? { 'data-folder-path': file.path } : {})}
              style={{
                display: 'grid', gridTemplateColumns: colTemplate, alignItems: 'center',
                padding: '6px 16px',
                borderLeft: isSelected ? '2px solid var(--th-accent)' : '2px solid transparent',
                background: dropTarget === file.path
                  ? 'var(--th-accent-drop)'
                  : isSelected ? 'var(--th-accent-subtle)' : undefined,
                outline: dropTarget === file.path ? '2px dashed var(--th-accent)' : undefined,
                outlineOffset: -2,
              }}
            >
              {/* Pick indicator */}
              <span
                onClick={(e) => { e.stopPropagation(); if (!file.isDirectory) togglePick(file.name) }}
                style={{
                  width: 0, height: 0, flexShrink: 0,
                  cursor: file.isDirectory ? 'default' : 'pointer',
                  ...((!file.isDirectory && pickedFiles.has(file.name)) ? {
                    borderStyle: 'solid', borderWidth: '6px 6px 0 0',
                    borderColor: 'var(--th-accent) var(--th-accent) transparent transparent',
                    borderRadius: '2px 0 0 0',
                  } : {}),
                }}
                title={file.isDirectory ? undefined : pickedFiles.has(file.name) ? 'Unpick' : 'Pick'}
              />

              {/* Icon */}
              <span className="flex justify-center" style={{ position: 'relative' }}>
                <FileTypeIcon type={file.type} size={16} />
                {file.cloudStatus === 'cloud' && (
                  <span style={{ position: 'absolute', bottom: -2, right: -2, fontSize: 7, color: '#3b82f6' }}>☁</span>
                )}
              </span>

              {/* Name — takes all remaining space */}
              <span className="truncate text-xs" style={{ minWidth: 0, paddingRight: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                {renamingPath === file.path ? (
                  <RenameInput name={file.name} onSubmit={(n) => handleRename(file, n)} onCancel={() => setRenamingPath(null)} />
                ) : (
                  <>
                    <span className="truncate">{file.name}</span>
                    {file.cloudStatus === 'cloud' && (
                      <span style={{ marginLeft: 6, fontSize: 10, color: '#3b82f6', fontWeight: 500, flexShrink: 0 }}>cloud</span>
                    )}


                  </>
                )}
              </span>

              {/* Type */}
              <span className="text-xs truncate text-center" style={{ color: getFileTypeColor(file.type) }}>
                {getFileTypeLabel(file.type)}
              </span>

              {/* Modified */}
              <span className="text-xs text-text-muted text-center truncate">
                {file.modified ? dateFormatter.format(new Date(file.modified)) : ''}
              </span>

              {/* Size */}
              <span className="text-xs text-text-muted text-right truncate">
                {file.isDirectory ? '' : formatFileSize(file.size)}
              </span>
            </div>
          )
        })}

        {/* New folder inline input (list view) */}
        {newFolderPending && (
          <NewFolderInput
            defaultName="Νέος Φάκελος"
            onSubmit={createNewFolder}
            onCancel={clearNewFolder}
            viewMode="list"
          />
        )}

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

        {/* Background context menu (list view) */}
        {bgCtxMenu && (
          <BackgroundContextMenu
            x={bgCtxMenu.x}
            y={bgCtxMenu.y}
            onClose={() => setBgCtxMenu(null)}
            onPaste={() => { setBgCtxMenu(null); pasteFiles() }}
            onNewFolder={() => { setBgCtxMenu(null); requestNewFolder() }}
            hasClipboard={!!clipboard}
          />
        )}
        {dragGhost && <DragGhost {...dragGhost} />}
      </div>
    )
  }

  // Grid view
  const cellSize = thumbnailSize + 24

  return (
    <div className="h-full overflow-y-auto" style={{ padding: 10 }} onContextMenu={handleBgContextMenu} onDrop={handleBgDrop} onDragOver={handleBgDragOver}>
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
            data-file-item
            className="flex flex-col items-center rounded-lg cursor-pointer"
            onMouseDown={(e) => handleItemMouseDown(e, file)}
            onDragOver={(e) => handleExternalDragOver(e, file)}
            onDragLeave={handleExternalDragLeave}
            onDrop={(e) => handleExternalDrop(e, file)}
            onClick={(e) => handleClick(e, file, index)}
            onDoubleClick={() => onOpen(file)}
            onContextMenu={(e) => handleContextMenu(e, file)}
            {...(file.isDirectory ? { 'data-folder-path': file.path } : {})}
            style={{
              padding: 4,
              border: dropTarget === file.path
                ? '2px dashed var(--th-accent)'
                : (selectedFile?.path === file.path || selectedFiles.some(f => f.path === file.path))
                  ? '1px solid var(--th-accent)' : '1px solid transparent',
              background: dropTarget === file.path
                ? 'var(--th-accent-drop)'
                : selectedFiles.some(f => f.path === file.path)
                  ? 'var(--th-accent-subtle)' : 'transparent',
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
              {/* Pick badge */}
              {!file.isDirectory && (
                <PickBadge
                  picked={pickedFiles.has(file.name)}
                  onClick={(e) => {
                    e.stopPropagation()
                    togglePick(file.name)
                  }}
                  size={thumbnailSize}
                />
              )}


            </div>

            {/* File name */}
            <div className="mt-1.5 w-full text-center">
              <div className="text-sm leading-tight truncate text-text-primary px-1">
                {renamingPath === file.path ? (
                  <RenameInput name={file.name} onSubmit={(n) => handleRename(file, n)} onCancel={() => setRenamingPath(null)} />
                ) : file.name}
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

      {/* New folder inline input (grid view) */}
      {newFolderPending && (
        <NewFolderInput
          defaultName="Νέος Φάκελος"
          onSubmit={createNewFolder}
          onCancel={clearNewFolder}
          viewMode="grid"
          thumbnailSize={thumbnailSize}
        />
      )}

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

      {/* Background context menu (grid view) */}
      {bgCtxMenu && (
        <BackgroundContextMenu
          x={bgCtxMenu.x}
          y={bgCtxMenu.y}
          onClose={() => setBgCtxMenu(null)}
          onPaste={() => { setBgCtxMenu(null); pasteFiles() }}
          onNewFolder={() => { setBgCtxMenu(null); requestNewFolder() }}
          hasClipboard={!!clipboard}
        />
      )}
      {dragGhost && <DragGhost {...dragGhost} />}
    </div>
  )
}

function DragGhost({ x, y, name, count }: { x: number; y: number; name: string; count: number }) {
  return (
    <div style={{
      position: 'fixed', left: x + 12, top: y + 12,
      pointerEvents: 'none', zIndex: 9999,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
      color: '#fff', fontSize: 12, fontWeight: 500,
      padding: '6px 12px', borderRadius: 8,
      maxWidth: 250, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    }}>
      {count > 1 ? `${count} αρχεία` : name}
    </div>
  )
}

function BackgroundContextMenu({ x, y, onClose, onPaste, onNewFolder, hasClipboard }: {
  x: number; y: number; onClose: () => void; onPaste: () => void; onNewFolder: () => void; hasClipboard: boolean
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const adjustedX = Math.max(8, Math.min(x, window.innerWidth - 200))
  const adjustedY = Math.max(8, Math.min(y, window.innerHeight - 120))

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-bg-tertiary border border-border rounded-lg shadow-xl animate-in fade-in zoom-in-95 duration-100"
      style={{ left: adjustedX, top: adjustedY, minWidth: 180, padding: 6 }}
    >
      {hasClipboard && (
        <button
          className="w-full flex items-center text-left hover:bg-bg-hover transition-colors text-text-secondary"
          style={{ gap: 10, padding: '7px 12px', fontSize: 12, borderRadius: 4 }}
          onClick={onPaste}
        >
          <Clipboard size={13} />
          <span style={{ flex: 1 }}>Paste</span>
          <span style={{ fontSize: 10, color: 'var(--th-text-muted)', opacity: 0.6 }}>Ctrl+V</span>
        </button>
      )}
      <button
        className="w-full flex items-center text-left hover:bg-bg-hover transition-colors text-text-secondary"
        style={{ gap: 10, padding: '7px 12px', fontSize: 12, borderRadius: 4 }}
        onClick={onNewFolder}
      >
        <FolderPlus size={13} />
        Νέος Φάκελος
      </button>
    </div>
  )
}

function NewFolderInput({ defaultName, onSubmit, onCancel, viewMode, thumbnailSize }: {
  defaultName: string
  onSubmit: (name: string) => void
  onCancel: () => void
  viewMode: 'grid' | 'list'
  thumbnailSize?: number
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Auto-focus and select all text
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus()
        inputRef.current.select()
      }
    }, 50)
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onSubmit(inputRef.current?.value || '')
    } else if (e.key === 'Escape') {
      onCancel()
    }
  }

  if (viewMode === 'list') {
    return (
      <div className="flex items-center gap-2" style={{ padding: '8px 20px', background: 'var(--th-accent-subtle)', borderLeft: '2px solid var(--th-accent)' }}>
        <span className="w-6 flex-shrink-0 flex justify-center">
          <Folder size={16} color="var(--th-accent)" fill="var(--th-accent)" fillOpacity={0.15} strokeWidth={1.5} />
        </span>
        <input
          ref={inputRef}
          defaultValue={defaultName}
          onKeyDown={handleKeyDown}
          onBlur={() => onSubmit(inputRef.current?.value || '')}
          style={{
            flex: 1, border: '1px solid var(--th-accent)', borderRadius: 4,
            padding: '4px 8px', fontSize: 12, outline: 'none',
            background: 'var(--th-bg-primary)', color: 'var(--th-text-primary)',
          }}
        />
      </div>
    )
  }

  // Grid view
  const size = thumbnailSize || 128
  return (
    <div className="flex flex-col items-center" style={{ padding: 4, border: '1px solid var(--th-accent)', borderRadius: 10, background: 'var(--th-accent-subtle)' }}>
      <div className="flex items-center justify-center" style={{ width: size, height: size }}>
        <FolderPlus size={size * 0.4} color="var(--th-accent)" strokeWidth={1.5} />
      </div>
      <div className="mt-1.5 w-full text-center">
        <input
          ref={inputRef}
          defaultValue={defaultName}
          onKeyDown={handleKeyDown}
          onBlur={() => onSubmit(inputRef.current?.value || '')}
          style={{
            width: '100%', border: '1px solid var(--th-accent)', borderRadius: 4,
            padding: '2px 6px', fontSize: 12, outline: 'none', textAlign: 'center',
            background: 'var(--th-bg-primary)', color: 'var(--th-text-primary)',
          }}
        />
      </div>
    </div>
  )
}

function PickBadge({ picked, onClick }: { picked: boolean; onClick: (e: React.MouseEvent) => void; size: number }) {
  return (
    <div
      onClick={onClick}
      title={picked ? 'Unpick' : 'Pick'}
      className="pick-badge"
      style={{
        position: 'absolute', top: -1, right: -1,
        width: 22, height: 22,
        cursor: 'pointer',
        zIndex: 2,
        opacity: picked ? 1 : 0,
        transition: 'opacity 0.15s ease',
        overflow: 'hidden',
        borderRadius: '0 6px 0 0',
      }}
    >
      {/* Triangle ribbon */}
      <div style={{
        position: 'absolute', top: 0, right: 0,
        width: 0, height: 0,
        borderStyle: 'solid',
        borderWidth: '0 22px 22px 0',
        borderColor: `transparent ${picked ? 'var(--th-accent)' : 'rgba(100,100,100,0.5)'} transparent transparent`,
      }} />
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

function RenameInput({ name, onSubmit, onCancel }: {
  name: string
  onSubmit: (newName: string) => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const doneRef = useRef(false)

  useEffect(() => {
    setTimeout(() => {
      if (!inputRef.current) return
      inputRef.current.focus()
      const dotIdx = name.lastIndexOf('.')
      inputRef.current.setSelectionRange(0, dotIdx > 0 ? dotIdx : name.length)
    }, 30)
  }, [name])

  const submit = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    onSubmit(inputRef.current?.value || name)
  }, [name, onSubmit])

  const cancel = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    onCancel()
  }, [onCancel])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Enter') submit()
    else if (e.key === 'Escape') cancel()
  }

  return (
    <input
      ref={inputRef}
      defaultValue={name}
      onKeyDown={handleKeyDown}
      onBlur={submit}
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      style={{
        width: '100%', border: '1px solid var(--th-accent)', borderRadius: 4,
        padding: '2px 6px', fontSize: 12, outline: 'none', textAlign: 'inherit',
        background: 'var(--th-bg-primary)', color: 'var(--th-text-primary)',
      }}
    />
  )
}

function SortIndicator({ active, asc }: { active: boolean; asc: boolean }) {
  if (!active) return null
  return asc ? <ArrowUp size={10} style={{ flexShrink: 0 }} /> : <ArrowDown size={10} style={{ flexShrink: 0 }} />
}

function SortableHeader({ label, sortKey, currentKey, asc, onSort }: {
  label: string
  sortKey: string
  currentKey: string
  asc: boolean
  onSort: (key: any) => void
}) {
  return (
    <span
      onClick={() => onSort(sortKey)}
      style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, userSelect: 'none' }}
    >
      {label}
      <SortIndicator active={currentKey === sortKey} asc={asc} />
    </span>
  )
}

function ResizableHeader({ label, onResize, align, sortKey, currentKey, asc, onSort }: {
  label: string
  onResize: (e: React.MouseEvent) => void
  align?: 'right' | 'left' | 'center'
  sortKey?: string
  currentKey?: string
  asc?: boolean
  onSort?: (key: any) => void
}) {
  const justify = align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start'
  return (
    <span style={{
      position: 'relative', userSelect: 'none',
      display: 'flex', alignItems: 'center', gap: 3,
      justifyContent: justify,
      cursor: onSort ? 'pointer' : undefined,
    }}
      onClick={onSort && sortKey ? () => onSort(sortKey) : undefined}
    >
      {/* Drag handle on the LEFT edge (border between this column and previous) */}
      <span
        onMouseDown={(e) => { e.stopPropagation(); onResize(e) }}
        style={{
          position: 'absolute', left: -5, top: -8, bottom: -8, width: 10,
          cursor: 'col-resize', zIndex: 2,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        onMouseEnter={e => { const line = e.currentTarget.firstElementChild as HTMLElement; if (line) line.style.background = 'var(--th-accent)' }}
        onMouseLeave={e => { const line = e.currentTarget.firstElementChild as HTMLElement; if (line) line.style.background = 'var(--th-border)' }}
      >
        <span style={{
          width: 2, height: '50%', borderRadius: 1,
          background: 'var(--th-border)',
          transition: 'background 0.15s',
        }} />
      </span>
      {label}
      {sortKey && currentKey && <SortIndicator active={currentKey === sortKey} asc={asc ?? true} />}
    </span>
  )
}
