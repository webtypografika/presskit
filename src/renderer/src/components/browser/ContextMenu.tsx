import { useEffect, useRef, useCallback } from 'react'
import {
  ExternalLink, FolderOpen, Scan, Link2, RefreshCw,
  Copy, Clipboard, Star, Eye, FileText, Download
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

export function ContextMenu({ file, x, y, onClose, onAction }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

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

  // Adjust position to keep menu in viewport
  const adjustedX = Math.min(x, window.innerWidth - 200)
  const adjustedY = Math.min(y, window.innerHeight - 300)

  const isFile = !file.isDirectory
  const isPrint = isFile && ['pdf', 'ai', 'psd', 'eps', 'indd', 'tiff'].includes(file.type)

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] bg-bg-tertiary border border-border rounded-lg shadow-xl py-1 animate-in fade-in zoom-in-95 duration-100"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {/* Preview / Open */}
      {isFile && (
        <MenuItem icon={<Eye size={13} />} label="Preview" onClick={() => onAction('preview')} />
      )}
      <MenuItem icon={<ExternalLink size={13} />} label="Open in app" onClick={() => onAction('openInApp')} />
      <MenuItem icon={<FolderOpen size={13} />} label="Show in folder" onClick={() => onAction('showInFolder')} />

      <Divider />

      {/* Print actions */}
      {isPrint && (
        <>
          <MenuItem icon={<Scan size={13} />} label="Run Preflight" onClick={() => onAction('preflight')} accent />
          <MenuItem icon={<RefreshCw size={13} />} label="Convert..." onClick={() => onAction('convert')} />
          <Divider />
        </>
      )}

      {/* PressCal actions */}
      {isFile && (
        <>
          <MenuItem icon={<Link2 size={13} />} label="Link to Quote..." onClick={() => onAction('linkQuote')} />
          <MenuItem icon={<Link2 size={13} />} label="Link to Job..." onClick={() => onAction('linkJob')} />
          <MenuItem icon={<Link2 size={13} />} label="Link to Customer..." onClick={() => onAction('linkCustomer')} />
          <MenuItem icon={<FileText size={13} />} label="Send via Email..." onClick={() => onAction('sendEmail')} />
          <Divider />
        </>
      )}

      {/* File operations */}
      <MenuItem icon={<Copy size={13} />} label="Copy path" onClick={() => onAction('copyPath')} />
      <MenuItem icon={<Star size={13} />} label={file.isDirectory ? 'Bookmark folder' : 'Copy name'} onClick={() => onAction(file.isDirectory ? 'bookmark' : 'copyName')} />
    </div>
  )
}

function MenuItem({ icon, label, onClick, accent, danger }: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  accent?: boolean
  danger?: boolean
}) {
  return (
    <button
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-bg-hover transition-colors ${
        accent ? 'text-accent' : danger ? 'text-error' : 'text-text-secondary'
      }`}
      onClick={onClick}
    >
      <span className="flex-shrink-0">{icon}</span>
      {label}
    </button>
  )
}

function Divider() {
  return <div className="h-px bg-border mx-2 my-1" />
}
