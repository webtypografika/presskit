import { useState, useEffect, useCallback } from 'react'
import {
  HardDrive, Star, Clock, FolderOpen, Cloud, Link2, ChevronDown, ChevronRight,
  Plus, X, File, Folder, Image, FileText, Type
} from 'lucide-react'
import { useAppStore } from '@/stores/app-store'
import { getFileTypeColor } from '@/lib/file-types'

interface UserPaths {
  desktop: string
  documents: string
  downloads: string
  dropbox: string
  home: string
}

export function Sidebar() {
  const { navigateTo, source, setSource, presscalConnected, dropboxConnected } = useAppStore()
  const [drives, setDrives] = useState<string[]>([])
  const [bookmarks, setBookmarks] = useState<string[]>([])
  const [recentPaths, setRecentPaths] = useState<string[]>([])
  const [userPaths, setUserPaths] = useState<UserPaths | null>(null)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    locations: true,
    bookmarks: true,
    recent: false,
    presscal: true
  })

  useEffect(() => {
    window.api.fs.getDrives().then(setDrives).catch(() => {})
    window.api.settings.get('paths.bookmarks').then((b: any) => setBookmarks(b || [])).catch(() => {})
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
            />
            <SidebarItem
              icon={<FolderOpen size={14} />}
              label="Documents"
              onClick={() => navigateTo(userPaths.documents)}
              dropPath={userPaths.documents}
            />
            <SidebarItem
              icon={<FolderOpen size={14} />}
              label="Downloads"
              onClick={() => navigateTo(userPaths.downloads)}
              dropPath={userPaths.downloads}
            />
            <SidebarItem
              icon={<FolderOpen size={14} />}
              label="Dropbox"
              onClick={() => navigateTo(userPaths.dropbox)}
              dropPath={userPaths.dropbox}
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
        {bookmarks.map(path => (
          <SidebarItem
            key={path}
            icon={<Star size={14} className="text-accent" />}
            label={path.split(/[/\\]/).pop() || path}
            sublabel={path}
            onClick={() => { if (source !== 'local') setSource('local'); navigateTo(path) }}
            onRemove={() => removeBookmark(path)}
            dropPath={path}
          />
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
          />
        ))}
      </SidebarSection>

      {/* Folder tree of current path */}
      <SidebarFolders />

      {/* PressCal Integration */}
      <SidebarSection
        title="PressCal"
        expanded={expandedSections.presscal}
        onToggle={() => toggleSection('presscal')}
      >
        <SidebarItem
          icon={<Link2 size={14} className={presscalConnected ? 'text-success' : 'text-text-muted'} />}
          label={presscalConnected ? 'Connected' : 'Not Connected'}
          muted={!presscalConnected}
          onClick={() => {}}
        />
      </SidebarSection>
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

function SidebarItem({ icon, label, sublabel, onClick, onRemove, muted, dropPath }: {
  icon: React.ReactNode
  label: string
  sublabel?: string
  onClick: () => void
  onRemove?: () => void
  muted?: boolean
  dropPath?: string
}) {
  const [dragOver, setDragOver] = useState(false)
  const { refreshDirectory } = useAppStore()

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!dropPath) return
    e.preventDefault()
    e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move'
    setDragOver(true)
  }, [dropPath])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (!dropPath) return
    const data = e.dataTransfer.getData('application/x-filehelper-paths')
    if (!data) return
    const paths: string[] = JSON.parse(data)
    const validPaths = paths.filter(p => p !== dropPath && !dropPath.startsWith(p + '/') && !dropPath.startsWith(p + '\\'))
    if (!validPaths.length) return
    if (e.ctrlKey) {
      await window.api.fs.copy(validPaths, dropPath)
    } else {
      await window.api.fs.move(validPaths, dropPath)
    }
    refreshDirectory()
  }, [dropPath, refreshDirectory])

  return (
    <div
      className={`group flex items-center gap-3 cursor-pointer hover:bg-bg-hover ${
        muted ? 'text-text-muted' : 'text-text-secondary'
      }`}
      style={{
        padding: '12px 32px',
        background: dragOver ? 'rgba(245,130,32,0.15)' : undefined,
        outline: dragOver ? '2px dashed #f58220' : undefined,
        outlineOffset: -2,
      }}
      onClick={onClick}
      title={sublabel || label}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
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
  )
}

function SidebarFolders() {
  const { files, navigateTo, currentPath, refreshDirectory } = useAppStore()
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
    const data = e.dataTransfer.getData('application/x-filehelper-paths')
    if (!data) return
    const paths: string[] = JSON.parse(data)
    const validPaths = paths.filter(p => p !== targetPath && !targetPath.startsWith(p + '/') && !targetPath.startsWith(p + '\\'))
    if (!validPaths.length) return
    if (e.ctrlKey) {
      await window.api.fs.copy(validPaths, targetPath)
    } else {
      await window.api.fs.move(validPaths, targetPath)
    }
    refreshDirectory()
  }

  return (
    <div className="border-b border-border" style={{ display: 'flex', flexDirection: 'column', maxHeight: '40vh' }}>
      <div style={{ padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <FolderOpen size={14} style={{ color: '#f58220' }} />
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
              background: dropTarget === folder.path ? 'rgba(245,130,32,0.15)' : undefined,
              outline: dropTarget === folder.path ? '2px dashed #f58220' : undefined,
              outlineOffset: -2,
            }}
            onMouseEnter={e => { if (dropTarget !== folder.path) e.currentTarget.style.background = 'var(--th-bg-hover)' }}
            onMouseLeave={e => { if (dropTarget !== folder.path) e.currentTarget.style.background = 'transparent' }}
          >
            <Folder size={13} style={{ color: '#f58220' }} />
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
