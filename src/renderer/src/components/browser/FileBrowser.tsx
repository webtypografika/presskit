import { useState, useRef, useEffect } from 'react'
import { useAppStore } from '@/stores/app-store'
import { FileGrid } from './FileGrid'
import { Loader2, Link2, X, CheckCircle, FolderPlus, Clipboard } from 'lucide-react'

export function FileBrowser() {
  const { files, loading, viewMode, selectedFile, selectFile, navigateTo, pickFileMode, pickedFiles, picksFilter } = useAppStore()
  const [linking, setLinking] = useState(false)
  const [linked, setLinked] = useState(false)

  const handlePickFile = async (file: any) => {
    if (!pickFileMode || file.isDirectory) return
    setLinking(true)
    try {
      await window.api.presscal.linkFileToItem(pickFileMode.quoteId, pickFileMode.itemId, file.path)
      setLinked(true)

      // Notify PressCal browser to refresh the quote page
      try {
        const status = await window.api.presscal.status()
        if (status.connected && status.url) {
          window.api.shell.openExternal(`${status.url}/quotes/${pickFileMode.quoteId}?refresh=${Date.now()}`)
        }
      } catch {}

      setTimeout(() => {
        useAppStore.setState({ pickFileMode: null })
        setLinked(false)
      }, 1500)
    } catch (e) {
      console.error('Link file error:', e)
    } finally {
      setLinking(false)
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted">
        <Loader2 size={24} className="animate-spin" />
      </div>
    )
  }

  if (files.length === 0) {
    return <EmptyFolderView />
  }

  return (
    <div className="h-full flex flex-col">
      {/* Pick file mode banner */}
      {pickFileMode && (
        <div style={{
          padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10,
          background: linked ? 'rgba(34,197,94,0.1)' : 'rgba(245,130,32,0.1)',
          borderBottom: `1px solid ${linked ? 'rgba(34,197,94,0.3)' : 'rgba(245,130,32,0.3)'}`,
          flexShrink: 0,
        }}>
          {linked ? (
            <>
              <CheckCircle size={16} style={{ color: '#22c55e' }} />
              <span style={{ fontSize: 13, color: '#22c55e', fontWeight: 600, flex: 1 }}>Αρχείο συνδέθηκε!</span>
            </>
          ) : linking ? (
            <>
              <Loader2 size={16} className="animate-spin" style={{ color: '#f58220' }} />
              <span style={{ fontSize: 13, color: '#f58220', flex: 1 }}>Σύνδεση...</span>
            </>
          ) : (
            <>
              <Link2 size={16} style={{ color: '#f58220' }} />
              <span style={{ fontSize: 13, color: '#f58220', fontWeight: 600, flex: 1 }}>
                Επιλέξτε αρχείο για σύνδεση με είδος προσφοράς
              </span>
              <button
                onClick={() => useAppStore.setState({ pickFileMode: null })}
                style={{ border: 'none', background: 'transparent', color: '#f58220', cursor: 'pointer' }}
              >
                <X size={16} />
              </button>
            </>
          )}
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        <FileGrid
          files={picksFilter === 'all' ? files : files.filter(f => {
            if (f.isDirectory) return true // always show folders
            const isPicked = pickedFiles.has(f.name)
            return picksFilter === 'picked' ? isPicked : !isPicked
          })}
          viewMode={viewMode}
          selectedFile={selectedFile}
          onSelect={(file) => {
            if (pickFileMode && !file.isDirectory) {
              handlePickFile(file)
            } else {
              selectFile(file)
            }
          }}
          onOpen={(file) => {
            if (file.isDirectory) {
              navigateTo(file.path)
            } else if (pickFileMode) {
              handlePickFile(file)
            } else {
              selectFile(file)
            }
          }}
        />
      </div>
    </div>
  )
}

function EmptyFolderView() {
  const { clipboard, pasteFiles, requestNewFolder, newFolderPending, clearNewFolder, createNewFolder } = useAppStore()
  const [bgCtx, setBgCtx] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!bgCtx) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setBgCtx(null)
    }
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setBgCtx(null) }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [bgCtx])

  const handleExternalDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    const { currentPath } = useAppStore.getState()
    if (!currentPath) return
    if (e.dataTransfer.files.length > 0) {
      const paths = Array.from(e.dataTransfer.files).map(f => f.path).filter(Boolean)
      if (paths.length > 0) {
        await window.api.fs.copy(paths, currentPath)
        useAppStore.getState().refreshDirectory()
      }
    }
  }

  return (
    <div
      className="h-full flex items-center justify-center text-text-muted text-sm"
      onContextMenu={(e) => {
        e.preventDefault()
        setBgCtx({ x: e.clientX, y: e.clientY })
      }}
      onDrop={handleExternalDrop}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
    >
      {newFolderPending ? (
        <NewFolderInline onSubmit={createNewFolder} onCancel={clearNewFolder} />
      ) : (
        'Κενός φάκελος'
      )}

      {bgCtx && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-bg-tertiary border border-border rounded-lg shadow-xl"
          style={{ left: bgCtx.x, top: bgCtx.y, minWidth: 180, padding: 6 }}
        >
          {clipboard && (
            <button
              className="w-full flex items-center text-left hover:bg-bg-hover transition-colors text-text-secondary"
              style={{ gap: 10, padding: '7px 12px', fontSize: 12, borderRadius: 4 }}
              onClick={() => { setBgCtx(null); pasteFiles() }}
            >
              <Clipboard size={13} />
              <span style={{ flex: 1 }}>Paste</span>
              <span style={{ fontSize: 10, color: 'var(--th-text-muted)', opacity: 0.6 }}>Ctrl+V</span>
            </button>
          )}
          <button
            className="w-full flex items-center text-left hover:bg-bg-hover transition-colors text-text-secondary"
            style={{ gap: 10, padding: '7px 12px', fontSize: 12, borderRadius: 4 }}
            onClick={() => { setBgCtx(null); requestNewFolder() }}
          >
            <FolderPlus size={13} />
            Νέος Φάκελος
          </button>
        </div>
      )}
    </div>
  )
}

function NewFolderInline({ onSubmit, onCancel }: { onSubmit: (name: string) => void; onCancel: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select() }, 50)
  }, [])
  return (
    <div className="flex items-center gap-2" style={{ padding: '8px 20px' }}>
      <FolderPlus size={16} color="#f58220" />
      <input
        ref={inputRef}
        defaultValue="Νέος Φάκελος"
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit(inputRef.current?.value || '')
          if (e.key === 'Escape') onCancel()
        }}
        onBlur={() => onSubmit(inputRef.current?.value || '')}
        style={{
          width: 200, border: '1px solid #f58220', borderRadius: 4,
          padding: '4px 8px', fontSize: 12, outline: 'none',
          background: 'var(--th-bg-primary)', color: 'var(--th-text-primary)',
        }}
      />
    </div>
  )
}
