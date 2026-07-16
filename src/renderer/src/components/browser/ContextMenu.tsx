import { useState, useEffect, useRef } from 'react'
import {
  ExternalLink, FolderOpen, Scan, RefreshCw,
  Copy, Star, ChevronRight, Trash2, Scissors, Clipboard, CircleCheck, Circle,
  FolderPlus, Pencil, PackageOpen
} from 'lucide-react'
import type { FileEntry } from '@/lib/file-types'
import { useAppStore } from '@/stores/app-store'

interface ContextMenuProps {
  file: FileEntry
  x: number
  y: number
  onClose: () => void
  onAction: (action: string) => void
}

interface AppInfo {
  id: string
  name: string
  path: string
  extensions: string[]
}

export function ContextMenu({ file, x, y, onClose, onAction }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [openWithApps, setOpenWithApps] = useState<AppInfo[]>([])
  const [showOpenWith, setShowOpenWith] = useState(false)
  // Measured position — starts offscreen, then adjusted after first layout
  const [pos, setPos] = useState<{ left: number; top: number; visible: boolean }>({
    left: x, top: y, visible: false
  })

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
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

  // Fetch available apps — show all installed apps for any file
  useEffect(() => {
    if (file.isDirectory) return
    window.api.apps.getOpenWith(file.extension || '')
      .then(setOpenWithApps)
      .catch(() => setOpenWithApps([]))
  }, [file])

  // After first layout, measure actual menu size and flip direction when
  // there is not enough room below/right of the click point.
  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const margin = 8
    const vw = window.innerWidth
    const vh = window.innerHeight

    let left = x
    let top = y

    // Horizontal: flip to the left of cursor if overflow on right
    if (left + rect.width + margin > vw) {
      left = x - rect.width
    }
    // Clamp to viewport
    left = Math.max(margin, Math.min(left, vw - rect.width - margin))

    // Vertical: flip above cursor if overflow on bottom
    if (top + rect.height + margin > vh) {
      top = y - rect.height
    }
    // Clamp to viewport
    top = Math.max(margin, Math.min(top, vh - rect.height - margin))

    setPos({ left, top, visible: true })
  }, [x, y, openWithApps.length])

  const isFile = !file.isDirectory
  const isPrint = isFile && ['pdf', 'ai', 'psd', 'eps', 'indd', 'tiff'].includes(file.type)
  const canConvert = isFile && ['pdf', 'ai', 'psd', 'eps', 'tiff', 'png', 'jpg', 'svg', 'raw'].includes(file.type)
  const isZip = isFile && file.name.toLowerCase().endsWith('.zip')
  const pickedFiles = useAppStore(s => s.pickedFiles)
  const isPicked = isFile && pickedFiles.has(file.name)

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-bg-tertiary border border-border rounded-lg shadow-xl animate-in fade-in zoom-in-95 duration-100"
      style={{
        left: pos.left, top: pos.top, minWidth: 200, padding: 6,
        visibility: pos.visible ? 'visible' : 'hidden',
      }}
    >
      {/* Pick/Unpick */}
      {isFile && (
        <>
          <MenuItem
            icon={isPicked ? <CircleCheck size={13} /> : <Circle size={13} />}
            label={isPicked ? 'Unpick' : 'Pick'}
            onClick={() => onAction('togglePick')}
            accent={!isPicked}
          />
          <Divider />
        </>
      )}

      {/* Open in app */}
      <MenuItem icon={<ExternalLink size={13} />} label="Open in app" onClick={() => onAction('openInApp')} />

      {/* Open with submenu */}
      {isFile && openWithApps.length > 0 && (
        <div
          className="relative"
          onMouseEnter={() => setShowOpenWith(true)}
          onMouseLeave={() => setShowOpenWith(false)}
        >
          <button
            className="w-full flex items-center text-left hover:bg-bg-hover transition-colors text-text-secondary"
            style={{ gap: 10, padding: '7px 12px', fontSize: 12, borderRadius: 4 }}
          >
            <span style={{ flexShrink: 0 }}><ExternalLink size={13} /></span>
            Open with
            <ChevronRight size={11} style={{ marginLeft: 'auto', color: '#64748b' }} />
          </button>

          {showOpenWith && (
            <div
              className="absolute z-50 border border-border rounded-lg shadow-xl"
              style={{ minWidth: 160, padding: 6, left: '100%', top: 0, marginLeft: -2, background: 'var(--th-bg-primary)' }}
            >
              {openWithApps.map(app => (
                <button
                  key={app.id}
                  className="w-full flex items-center text-left hover:bg-bg-hover transition-colors text-text-secondary"
                  style={{ gap: 10, padding: '7px 12px', fontSize: 12, borderRadius: 4 }}
                  onClick={() => {
                    window.api.apps.openWith(app.path, file.path)
                    onClose()
                  }}
                >
                  {app.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <MenuItem icon={<FolderOpen size={13} />} label="Show in folder" onClick={() => onAction('showInFolder')} />

      <Divider />

      {/* Print / Convert / Extract actions */}
      {(isPrint || canConvert || isZip) && (
        <>
          {isPrint && <MenuItem icon={<Scan size={13} />} label="Run Preflight" onClick={() => onAction('preflight')} accent />}
          {canConvert && <MenuItem icon={<RefreshCw size={13} />} label="Convert..." onClick={() => onAction('convert')} />}
          {isZip && <MenuItem icon={<PackageOpen size={13} />} label="Αποσυμπίεση..." onClick={() => onAction('extractZip')} />}
          <Divider />
        </>
      )}

      {/* Copy / Cut / Paste */}
      <MenuItem icon={<Copy size={13} />} label="Copy" onClick={() => onAction('copyFile')} shortcut="Ctrl+C" />
      <MenuItem icon={<Scissors size={13} />} label="Cut" onClick={() => onAction('cutFile')} shortcut="Ctrl+X" />
      <PasteMenuItem onAction={onAction} />

      <Divider />

      {/* File operations */}
      <MenuItem icon={<Pencil size={13} />} label="Rename" onClick={() => onAction('rename')} shortcut="F2" />
      <MenuItem icon={<Copy size={13} />} label="Copy path" onClick={() => onAction('copyPath')} />
      <MenuItem icon={<Star size={13} />} label={file.isDirectory ? 'Bookmark folder' : 'Copy name'} onClick={() => onAction(file.isDirectory ? 'bookmark' : 'copyName')} />

      <Divider />
      <MenuItem icon={<FolderPlus size={13} />} label="Νέος Φάκελος" onClick={() => onAction('newFolder')} />
      <MenuItem icon={<Trash2 size={13} />} label="Delete" onClick={() => onAction('delete')} danger />
    </div>
  )
}

function PasteMenuItem({ onAction }: { onAction: (action: string) => void }) {
  const clipboard = useAppStore(s => s.clipboard)
  if (!clipboard) return null
  const count = clipboard.files.length
  const label = `Paste${count > 1 ? ` (${count})` : ''}`
  return <MenuItem icon={<Clipboard size={13} />} label={label} onClick={() => onAction('pasteFile')} shortcut="Ctrl+V" />
}

function MenuItem({ icon, label, onClick, accent, danger, shortcut, disabled }: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  accent?: boolean
  danger?: boolean
  shortcut?: string
  disabled?: boolean
}) {
  return (
    <button
      className={`w-full flex items-center text-left hover:bg-bg-hover transition-colors ${
        disabled ? 'text-text-muted cursor-not-allowed' :
        accent ? 'text-accent' : danger ? 'text-error' : 'text-text-secondary'
      }`}
      style={{ gap: 10, padding: '7px 12px', fontSize: 12, borderRadius: 4 }}
      onClick={disabled ? undefined : onClick}
    >
      <span style={{ flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {shortcut && <span style={{ fontSize: 10, color: 'var(--th-text-muted)', opacity: 0.6 }}>{shortcut}</span>}
    </button>
  )
}

function Divider() {
  return <div className="h-px bg-border mx-3 my-1.5" />
}
