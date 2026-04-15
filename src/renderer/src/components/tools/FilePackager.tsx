import { useState, useCallback } from 'react'
import { useAppStore } from '@/stores/app-store'
import { Package, FolderOpen, Loader2, Check, AlertTriangle } from 'lucide-react'

export function FilePackager({ onClose }: { onClose: () => void }) {
  const { currentPath, selectedFiles, selectedFile } = useAppStore()
  const [targetDir, setTargetDir] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scannedFiles, setScannedFiles] = useState<string[]>([])
  const [collecting, setCollecting] = useState(false)
  const [result, setResult] = useState<{ copied: number; errors: string[] } | null>(null)
  const [mode, setMode] = useState<'selected' | 'directory'>('directory')

  const scanDirectory = useCallback(async () => {
    if (!currentPath) return
    setScanning(true)
    try {
      const files = await window.api.tools.collectJobFiles(currentPath)
      setScannedFiles(files)
    } catch {}
    setScanning(false)
  }, [currentPath])

  const pickTarget = useCallback(async () => {
    const result = await window.api.dialog.openDirectory()
    if (result) setTargetDir(result)
  }, [])

  const doCollect = useCallback(async () => {
    if (!targetDir) return

    const filesToCollect = mode === 'selected'
      ? (selectedFiles.length > 0 ? selectedFiles : selectedFile ? [selectedFile] : []).map(f => f.path)
      : scannedFiles

    if (filesToCollect.length === 0) return

    setCollecting(true)
    try {
      const res = await window.api.tools.collectFiles(filesToCollect, targetDir)
      setResult(res)
    } catch (err) {
      setResult({ copied: 0, errors: [String(err)] })
    }
    setCollecting(false)
  }, [targetDir, mode, selectedFiles, selectedFile, scannedFiles])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60,
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: 500, background: 'var(--th-bg-secondary)', borderRadius: 14,
        border: '1px solid var(--th-border)', display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--th-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Package size={18} style={{ color: '#f58220' }} />
          <span style={{ fontSize: 15, fontWeight: 600, flex: 1, color: 'var(--th-text-primary)' }}>Collect / Package Files</span>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 18 }}>&times;</button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Mode */}
          <div style={{ display: 'flex', gap: 4, background: 'var(--th-bg-primary)', borderRadius: 8, padding: 3 }}>
            <button onClick={() => setMode('directory')} style={{
              flex: 1, padding: '6px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              border: 'none', cursor: 'pointer',
              background: mode === 'directory' ? 'rgba(245,130,32,0.15)' : 'transparent',
              color: mode === 'directory' ? '#f58220' : '#94a3b8',
            }}>
              Φάκελος εργασίας
            </button>
            <button onClick={() => setMode('selected')} style={{
              flex: 1, padding: '6px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              border: 'none', cursor: 'pointer',
              background: mode === 'selected' ? 'rgba(245,130,32,0.15)' : 'transparent',
              color: mode === 'selected' ? '#f58220' : '#94a3b8',
            }}>
              Επιλεγμένα αρχεία
            </button>
          </div>

          {/* Source info */}
          {mode === 'directory' && (
            <>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                Φάκελος: <span style={{ fontFamily: 'monospace', color: '#cbd5e1' }}>{currentPath}</span>
              </div>
              <button onClick={scanDirectory} disabled={scanning} style={{
                padding: '8px 16px', borderRadius: 8, border: '1px solid var(--th-border)',
                background: 'transparent', color: 'var(--th-text-secondary)', fontSize: 12,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                {scanning ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                {scanning ? 'Σάρωση...' : 'Σάρωση για print αρχεία'}
              </button>
              {scannedFiles.length > 0 && (
                <div style={{ fontSize: 12, color: '#22c55e' }}>
                  Βρέθηκαν {scannedFiles.length} αρχεία εκτύπωσης
                </div>
              )}
            </>
          )}

          {mode === 'selected' && (
            <div style={{ fontSize: 12, color: '#94a3b8' }}>
              {selectedFiles.length > 0
                ? `${selectedFiles.length} αρχεία επιλεγμένα`
                : selectedFile
                  ? `1 αρχείο: ${selectedFile.name}`
                  : 'Δεν υπάρχουν επιλεγμένα αρχεία'}
            </div>
          )}

          {/* Target */}
          <div>
            <label style={{ fontSize: 11, color: '#64748b', fontWeight: 600, display: 'block', marginBottom: 4 }}>
              Φάκελος προορισμού
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={targetDir}
                onChange={e => setTargetDir(e.target.value)}
                placeholder="Επιλέξτε φάκελο..."
                style={{
                  flex: 1, padding: '8px 12px', borderRadius: 8,
                  background: 'var(--th-bg-primary)', border: '1px solid var(--th-border)',
                  color: 'var(--th-text-primary)', fontSize: 13, outline: 'none',
                }}
              />
              <button onClick={pickTarget} style={{
                padding: '8px 12px', borderRadius: 8, border: '1px solid var(--th-border)',
                background: 'transparent', color: 'var(--th-text-secondary)', fontSize: 12, cursor: 'pointer',
              }}>
                Browse
              </button>
            </div>
          </div>

          {/* Collect button */}
          <button
            onClick={doCollect}
            disabled={!targetDir || collecting || (mode === 'directory' && scannedFiles.length === 0)}
            style={{
              padding: '10px 16px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600,
              background: result ? '#22c55e' : '#f58220', color: '#fff', cursor: 'pointer',
              opacity: !targetDir || collecting ? 0.5 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {collecting ? <Loader2 size={14} className="animate-spin" /> : result ? <Check size={14} /> : <Package size={14} />}
            {collecting ? 'Collecting...' : result ? `${result.copied} αρχεία collected!` : 'Collect Files'}
          </button>

          {/* Result errors */}
          {result && result.errors.length > 0 && (
            <div style={{ padding: '8px 10px', borderRadius: 6, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <AlertTriangle size={12} style={{ color: '#ef4444' }} />
                <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>{result.errors.length} errors</span>
              </div>
              {result.errors.slice(0, 5).map((err, i) => (
                <div key={i} style={{ fontSize: 11, color: '#64748b' }}>{err}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
