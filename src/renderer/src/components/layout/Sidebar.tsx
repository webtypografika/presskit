import { useState, useEffect, useCallback, useRef } from 'react'
import {
  HardDrive, Star, Clock, FolderOpen, Cloud, ChevronDown, ChevronRight,
  Plus, X, File, Folder, Image, FileText, Type
} from 'lucide-react'
import { useAppStore } from '@/stores/app-store'
import { getFileTypeColor } from '@/lib/file-types'
import { dragState } from '@/lib/drag-state'

interface UserPaths {
  desktop: string
  documents: string
  downloads: string
  dropbox: string
  home: string
}

function normPath(p: string): string {
  return p.replace(/[\\/]+$/, '').toLowerCase()
}

export function Sidebar() {
  const source = useAppStore(s => s.source)
  const currentPath = useAppStore(s => s.currentPath)

  const dropboxConnected = useAppStore(s => s.dropboxConnected)
  const navigateTo = useAppStore(s => s.navigateTo)
  const setSource = useAppStore(s => s.setSource)
  const [drives, setDrives] = useState<string[]>([])
  const [bookmarks, setBookmarks] = useState<string[]>([])
  const [recentPaths, setRecentPaths] = useState<string[]>([])
  const [userPaths, setUserPaths] = useState<UserPaths | null>(null)
  const [bookmarkColors, setBookmarkColors] = useState<Record<string, string>>({})
  const [colorPickerPath, setColorPickerPath] = useState<string | null>(null)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    locations: true,
    bookmarks: true,
    recent: false
  })

  useEffect(() => {
    window.api.fs.getDrives().then(setDrives).catch(() => {})
    window.api.settings.get('paths.bookmarks').then((b: any) => setBookmarks(b || [])).catch(() => {})
    window.api.settings.get('paths.bookmarkColors').then((c: any) => setBookmarkColors(c || {})).catch(() => {})
    window.api.settings.get('paths.recent').then((r: any) => setRecentPaths(r || [])).catch(() => {})
    window.api.system.userPaths().then(setUserPaths).catch(() => {})
  }, [])

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const removeBookmark = async (path: string) => {
    const updated = await window.api.settings.removeBookmark(path)
    setBookmarks(updated)
  }

  const setBookmarkColor = async (path: string, color: string | null) => {
    const updated = await window.api.settings.setBookmarkColor(path, color)
    setBookmarkColors(updated)
    setColorPickerPath(null)
  }

  const BOOKMARK_COLORS = [
    '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280',
  ]

  const dragBookmark = useRef<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const handleBookmarkDragStart = (e: React.DragEvent, index: number) => {
    dragBookmark.current = index
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/x-bookmark-reorder', String(index))
  }

  const handleBookmarkDragOver = (e: React.DragEvent, index: number) => {
    if (dragBookmark.current === null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }

  const handleBookmarkDrop = async (e: React.DragEvent, toIndex: number) => {
    e.preventDefault()
    setDragOverIndex(null)
    const fromIndex = dragBookmark.current
    dragBookmark.current = null
    if (fromIndex === null || fromIndex === toIndex) return
    const updated = await window.api.settings.reorderBookmarks(fromIndex, toIndex)
    setBookmarks(updated)
  }

  const handleBookmarkDragEnd = () => {
    dragBookmark.current = null
    setDragOverIndex(null)
  }

  return (
    <div className="h-full bg-bg-secondary flex flex-col overflow-y-auto">
      {/* Locations */}
      <SidebarSection
        title="Locations"
        expanded={expandedSections.locations}
        onToggle={() => toggleSection('locations')}
      >
        {source === 'local' && drives.map(drive => (
          <SidebarItem
            key={drive}
            icon={<HardDrive size={14} />}
            label={drive}
            onClick={() => navigateTo(drive)}
            active={normPath(currentPath) === normPath(drive)}
          />
        ))}

        {/* Common folders */}
        {source === 'local' && userPaths && (
          <>
            <SidebarItem
              icon={<FolderOpen size={14} />}
              label="Desktop"
              onClick={() => navigateTo(userPaths.desktop)}
              dropPath={userPaths.desktop}
              active={normPath(currentPath).startsWith(normPath(userPaths.desktop))}
            />
            <SidebarItem
              icon={<FolderOpen size={14} />}
              label="Documents"
              onClick={() => navigateTo(userPaths.documents)}
              dropPath={userPaths.documents}
              active={normPath(currentPath).startsWith(normPath(userPaths.documents))}
            />
            <SidebarItem
              icon={<FolderOpen size={14} />}
              label="Downloads"
              onClick={() => navigateTo(userPaths.downloads)}
              dropPath={userPaths.downloads}
              active={normPath(currentPath).startsWith(normPath(userPaths.downloads))}
            />
            <SidebarItem
              icon={<FolderOpen size={14} />}
              label="Dropbox"
              onClick={() => navigateTo(userPaths.dropbox)}
              dropPath={userPaths.dropbox}
              active={normPath(currentPath).startsWith(normPath(userPaths.dropbox))}
            />
          </>
        )}

        {source === 'dropbox' && (
          <SidebarItem
            icon={<Cloud size={14} />}
            label={dropboxConnected ? 'Dropbox Root' : 'Connect Dropbox...'}
            onClick={() => navigateTo('')}
            muted={!dropboxConnected}
          />
        )}
      </SidebarSection>

      {/* Bookmarks */}
      <SidebarSection
        title="Bookmarks"
        expanded={expandedSections.bookmarks}
        onToggle={() => toggleSection('bookmarks')}
        action={
          <button
            className="p-0.5 text-text-muted hover:text-text-primary"
            onClick={async () => {
              const dir = await window.api.dialog.openDirectory()
              if (dir) {
                const updated = await window.api.settings.addBookmark(dir)
                setBookmarks(updated)
              }
            }}
            title="Add bookmark"
          >
            <Plus size={12} />
          </button>
        }
      >
        {bookmarks.map((path, index) => (
          <SidebarItem
            key={path}
            icon={
              <span
                style={{
                  width: 14, height: 14, borderRadius: '50%', display: 'inline-flex',
                  alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  background: bookmarkColors[path] || 'transparent',
                  border: bookmarkColors[path] ? 'none' : '2px solid var(--th-accent)',
                  cursor: 'pointer', position: 'relative',
                }}
                onClick={(e) => { e.stopPropagation(); setColorPickerPath(colorPickerPath === path ? null : path) }}
                title="Set color"
              >
                {!bookmarkColors[path] && <Star size={8} style={{ color: 'var(--th-accent)' }} />}
              </span>
            }
            label={path.split(/[/\\]/).pop() || path}
            sublabel={path}
            onClick={() => { if (source !== 'local') setSource('local'); navigateTo(path) }}
            onRemove={() => removeBookmark(path)}
            dropPath={path}
            active={normPath(currentPath).startsWith(normPath(path))}
            accentColor={bookmarkColors[path]}
            draggable
            onDragStart={(e) => handleBookmarkDragStart(e, index)}
            onDragOverBookmark={(e) => handleBookmarkDragOver(e, index)}
            onDropBookmark={(e) => handleBookmarkDrop(e, index)}
            onDragEnd={handleBookmarkDragEnd}
            isDropTarget={dragOverIndex === index}
          >
            {colorPickerPath === path && (
              <div
                style={{
                  display: 'flex', gap: 4, padding: '4px 0 2px',
                  flexWrap: 'wrap', alignItems: 'center',
                }}
                onClick={e => e.stopPropagation()}
              >
                {BOOKMARK_COLORS.map(c => (
                  <span
                    key={c}
                    onClick={() => setBookmarkColor(path, c)}
                    style={{
                      width: 16, height: 16, borderRadius: '50%', background: c,
                      cursor: 'pointer', border: bookmarkColors[path] === c ? '2px solid white' : '1px solid rgba(255,255,255,0.2)',
                      boxShadow: bookmarkColors[path] === c ? '0 0 0 1px ' + c : undefined,
                    }}
                  />
                ))}
                {bookmarkColors[path] && (
                  <span
                    onClick={() => setBookmarkColor(path, null)}
                    style={{
                      width: 16, height: 16, borderRadius: '50%', cursor: 'pointer',
                      border: '1px solid var(--th-text-muted)', display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, color: 'var(--th-text-muted)',
                    }}
                  >
                    <X size={8} />
                  </span>
                )}
              </div>
            )}
          </SidebarItem>
        ))}
        {bookmarks.length === 0 && (
          <div className="px-4 py-2 text-text-muted text-sm">No bookmarks</div>
        )}
      </SidebarSection>

      {/* Recent */}
      <SidebarSection
        title="Recent"
        expanded={expandedSections.recent}
        onToggle={() => toggleSection('recent')}
      >
        {recentPaths.slice(0, 10).map(path => (
          <SidebarItem
            key={path}
            icon={<Clock size={14} />}
            label={path.split(/[/\\]/).pop() || path}
            sublabel={path}
            onClick={() => { if (source !== 'local') setSource('local'); navigateTo(path) }}
            active={normPath(currentPath) === normPath(path)}
          />
        ))}
      </SidebarSection>

      {/* Folder tree of current path */}
      <SidebarFolders />

    </div>
  )
}

function SidebarSection({ title, expanded, onToggle, action, children }: {
  title: string
  expanded: boolean
  onToggle: () => void
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="border-b border-border">
      <div
        className="flex items-center justify-between cursor-pointer hover:bg-bg-hover"
        style={{ padding: '16px 24px' }}
        onClick={onToggle}
      >
        <div className="flex items-center gap-2 text-text-secondary text-sm font-semibold uppercase tracking-wider">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {title}
        </div>
        {action && <div onClick={e => e.stopPropagation()}>{action}</div>}
      </div>
      {expanded && <div className="py-2">{children}</div>}
    </div>
  )
}

function SidebarItem({ icon, label, sublabel, onClick, onRemove, muted, dropPath, active,
  accentColor, children,
  draggable: isDraggable, onDragStart, onDragOverBookmark, onDropBookmark, onDragEnd, isDropTarget
}: {
  icon: React.ReactNode
  label: string
  sublabel?: string
  onClick: () => void
  onRemove?: () => void
  muted?: boolean
  dropPath?: string
  active?: boolean
  accentColor?: string
  children?: React.ReactNode
  draggable?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragOverBookmark?: (e: React.DragEvent) => void
  onDropBookmark?: (e: React.DragEvent) => void
  onDragEnd?: () => void
  isDropTarget?: boolean
}) {
  const [dragOver, setDragOver] = useState(false)
  const refreshDirectory = useAppStore(s => s.refreshDirectory)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    // Bookmark reorder takes priority
    if (e.dataTransfer.types.includes('text/x-bookmark-reorder')) {
      onDragOverBookmark?.(e)
      return
    }
    if (!dropPath) return
    e.preventDefault()
    e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move'
    setDragOver(true)
  }, [dropPath, onDragOverBookmark])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    // Bookmark reorder
    if (e.dataTransfer.types.includes('text/x-bookmark-reorder')) {
      onDropBookmark?.(e)
      return
    }
    if (!dropPath) return
    const internalPaths = dragState.get()
    const isInternal = internalPaths.length > 0
    const sourcePaths = isInternal
      ? [...internalPaths]
      : Array.from(e.dataTransfer.files).map(f => window.api.fs.getFilePath(f)).filter(Boolean)
    if (!sourcePaths.length) return
    const validPaths = sourcePaths.filter(p => p !== dropPath && !dropPath.startsWith(p + '/') && !dropPath.startsWith(p + '\\'))
    if (!validPaths.length) return
    if (isInternal && !e.ctrlKey) {
      await window.api.fs.move(validPaths, dropPath)
    } else {
      await window.api.fs.copy(validPaths, dropPath)
    }
    refreshDirectory()
  }, [dropPath, refreshDirectory, onDropBookmark])

  const highlight = dragOver || isDropTarget

  const borderColor = accentColor || (active ? 'var(--th-accent)' : 'transparent')

  return (
    <div
      className={`group cursor-pointer hover:bg-bg-hover ${
        muted ? 'text-text-muted' : active ? 'text-text-primary' : 'text-text-secondary'
      }`}
      style={{
        padding: '12px 32px',
        background: highlight ? 'var(--th-accent-subtle)' : active ? 'var(--th-bg-hover)' : undefined,
        borderLeft: `3px solid ${borderColor}`,
        paddingLeft: 29,
        borderTop: isDropTarget ? '2px solid var(--th-accent)' : '2px solid transparent',
        outline: dragOver ? '2px dashed var(--th-accent)' : undefined,
        outlineOffset: -2,
        fontWeight: active ? 600 : undefined,
      }}
      onClick={onClick}
      title={sublabel || label}
      draggable={isDraggable}
      onDragStart={onDragStart}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onDragEnd={onDragEnd}
    >
      <div className="flex items-center gap-3">
        <span className="flex-shrink-0">{icon}</span>
        <span className="truncate flex-1">{label}</span>
        {onRemove && (
          <button
            className="ml-auto opacity-0 group-hover:opacity-100 p-0.5 hover:text-error"
            onClick={e => { e.stopPropagation(); onRemove() }}
          >
            <X size={12} />
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

function SidebarFolders() {
  const files = useAppStore(s => s.files)
  const currentPath = useAppStore(s => s.currentPath)
  const navigateTo = useAppStore(s => s.navigateTo)
  const refreshDirectory = useAppStore(s => s.refreshDirectory)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  if (!currentPath) return null

  const folders = files.filter(f => f.isDirectory)
  const folderName = currentPath.split(/[/\\]/).pop() || currentPath

  if (folders.length === 0) return null

  const handleDragOver = (e: React.DragEvent, path: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move'
    setDropTarget(path)
  }

  const handleDrop = async (e: React.DragEvent, targetPath: string) => {
    e.preventDefault()
    setDropTarget(null)
    // Internal drags carry their paths via dragState (see drag-state.ts).
    // External drags (from Explorer) can also be dropped onto sibling folders.
    const internalPaths = dragState.get()
    const isInternal = internalPaths.length > 0
    const sourcePaths = isInternal
      ? [...internalPaths]
      : Array.from(e.dataTransfer.files).map(f => window.api.fs.getFilePath(f)).filter(Boolean)
    if (!sourcePaths.length) return
    const validPaths = sourcePaths.filter(p => p !== targetPath && !targetPath.startsWith(p + '/') && !targetPath.startsWith(p + '\\'))
    if (!validPaths.length) return
    if (isInternal && !e.ctrlKey) {
      await window.api.fs.move(validPaths, targetPath)
    } else {
      await window.api.fs.copy(validPaths, targetPath)
    }
    refreshDirectory()
  }

  return (
    <div className="border-b border-border" style={{ display: 'flex', flexDirection: 'column', maxHeight: '40vh' }}>
      <div style={{ padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <FolderOpen size={14} style={{ color: 'var(--th-accent)' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--th-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {folderName}
        </span>
        <span style={{ fontSize: 11, color: 'var(--th-text-muted)', opacity: 0.7 }}>{folders.length}</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {folders.map(folder => (
          <div
            key={folder.path}
            onClick={() => navigateTo(folder.path)}
            onDragOver={e => handleDragOver(e, folder.path)}
            onDragLeave={() => setDropTarget(null)}
            onDrop={e => handleDrop(e, folder.path)}
            style={{
              padding: '7px 32px',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
              background: dropTarget === folder.path ? 'rgba(110,200,200,0.15)' : undefined,
              outline: dropTarget === folder.path ? '2px dashed var(--th-accent)' : undefined,
              outlineOffset: -2,
            }}
            onMouseEnter={e => { if (dropTarget !== folder.path) e.currentTarget.style.background = 'var(--th-bg-hover)' }}
            onMouseLeave={e => { if (dropTarget !== folder.path) e.currentTarget.style.background = 'transparent' }}
          >
            <Folder size={13} style={{ color: 'var(--th-accent)' }} />
            <span style={{
              fontSize: 12, color: 'var(--th-text-muted)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
            }}>
              {folder.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
