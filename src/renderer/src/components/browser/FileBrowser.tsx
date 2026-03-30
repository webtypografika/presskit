import { useState } from 'react'
import { useAppStore } from '@/stores/app-store'
import { FileGrid } from './FileGrid'
import { Loader2, Link2, X, CheckCircle } from 'lucide-react'

export function FileBrowser() {
  const { files, loading, viewMode, selectedFile, selectFile, navigateTo, pickFileMode } = useAppStore()
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
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-sm">
        Empty folder
      </div>
    )
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
          files={files}
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
