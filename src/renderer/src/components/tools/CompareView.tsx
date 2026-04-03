import { useState, useCallback } from 'react'
import { useAppStore } from '@/stores/app-store'
import { Columns, Loader2, ArrowLeftRight, Layers } from 'lucide-react'

interface CompareResult {
  file1: { path: string; thumbnail: string; width: number; height: number }
  file2: { path: string; thumbnail: string; width: number; height: number }
  diffImage?: string
  diffPercentage: number
}

export function CompareView({ onClose }: { onClose: () => void }) {
  const { selectedFile, currentPath, files } = useAppStore()
  const [file2Path, setFile2Path] = useState('')
  const [result, setResult] = useState<CompareResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [viewMode, setViewMode] = useState<'side' | 'diff' | 'overlay'>('side')
  const [overlayOpacity, setOverlayOpacity] = useState(50)

  // Get comparable files from current directory
  const imageExts = ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.bmp', '.webp']
  const comparableFiles = files
    .filter(f => !f.isDirectory && imageExts.includes(f.extension?.toLowerCase()) && f.path !== selectedFile?.path)

  const doCompare = useCallback(async () => {
    if (!selectedFile?.path || !file2Path) return
    setLoading(true)
    try {
      const res = await window.api.tools.compareFiles(selectedFile.path, file2Path)
      setResult(res)
    } catch (err) {
      console.error('Compare error:', err)
    }
    setLoading(false)
  }, [selectedFile?.path, file2Path])

  const selectStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: 8,
    background: 'var(--th-bg-primary)', border: '1px solid var(--th-border)',
    color: 'var(--th-text-primary)', fontSize: 13, outline: 'none',
    cursor: 'pointer',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60,
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '90%', maxWidth: 1200, height: '85%',
        background: 'var(--th-bg-secondary)', borderRadius: 14,
        border: '1px solid var(--th-border)', display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '12px 20px', borderBottom: '1px solid var(--th-border)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <Columns size={18} style={{ color: '#f58220' }} />
          <span style={{ fontSize: 15, fontWeight: 600, flex: 1, color: 'var(--th-text-primary)' }}>Σύγκριση Αρχείων</span>

          {result && (
            <div style={{ display: 'flex', gap: 4, background: 'var(--th-bg-primary)', borderRadius: 8, padding: 3 }}>
              {(['side', 'diff', 'overlay'] as const).map(m => (
                <button key={m} onClick={() => setViewMode(m)} style={{
                  padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                  border: 'none', cursor: 'pointer',
                  background: viewMode === m ? 'rgba(245,130,32,0.15)' : 'transparent',
                  color: viewMode === m ? '#f58220' : '#94a3b8',
                }}>
                  {m === 'side' ? 'Side by Side' : m === 'diff' ? 'Differences' : 'Overlay'}
                </button>
              ))}
            </div>
          )}

          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 20 }}>&times;</button>
        </div>

        {/* Setup or result */}
        {!result ? (
          <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', flex: 1, justifyContent: 'center' }}>
            <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
              {/* File 1 */}
              <div style={{ textAlign: 'center' }}>
                <div style={{ width: 120, height: 120, borderRadius: 12, background: 'var(--th-bg-primary)', border: '1px solid var(--th-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: '#64748b' }}>{selectedFile?.name || 'Select file'}</span>
                </div>
                <div style={{ fontSize: 11, color: '#64748b' }}>Αρχείο 1 (selected)</div>
              </div>

              <ArrowLeftRight size={24} style={{ color: '#64748b' }} />

              {/* File 2 */}
              <div style={{ textAlign: 'center' }}>
                <div style={{ width: 200 }}>
                  <select value={file2Path} onChange={e => setFile2Path(e.target.value)} style={selectStyle}>
                    <option value="">Επιλέξτε αρχείο...</option>
                    {comparableFiles.map(f => (
                      <option key={f.path} value={f.path}>{f.name}</option>
                    ))}
                  </select>
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>Αρχείο 2</div>
              </div>
            </div>

            <button onClick={doCompare} disabled={!file2Path || loading} style={{
              padding: '12px 32px', borderRadius: 10, border: 'none', fontSize: 14, fontWeight: 600,
              background: '#f58220', color: '#fff', cursor: 'pointer',
              opacity: !file2Path || loading ? 0.5 : 1,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Columns size={16} />}
              {loading ? 'Σύγκριση...' : 'Σύγκριση'}
            </button>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Diff info */}
            <div style={{
              padding: '8px 20px', borderBottom: '1px solid var(--th-border)',
              display: 'flex', alignItems: 'center', gap: 12,
              background: result.diffPercentage > 10 ? 'rgba(239,68,68,0.05)' : result.diffPercentage > 1 ? 'rgba(234,179,8,0.05)' : 'rgba(34,197,94,0.05)',
            }}>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>Διαφορά:</span>
              <span style={{
                fontSize: 14, fontWeight: 700,
                color: result.diffPercentage > 10 ? '#ef4444' : result.diffPercentage > 1 ? '#eab308' : '#22c55e',
              }}>
                {result.diffPercentage}%
              </span>
              <span style={{ fontSize: 11, color: '#64748b' }}>
                {result.file1.width}x{result.file1.height} vs {result.file2.width}x{result.file2.height}
              </span>

              {viewMode === 'overlay' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                  <span style={{ fontSize: 11, color: '#64748b' }}>Opacity:</span>
                  <input type="range" min={0} max={100} value={overlayOpacity}
                    onChange={e => setOverlayOpacity(Number(e.target.value))}
                    style={{ width: 100, accentColor: '#f58220' }} />
                  <span style={{ fontSize: 11, color: '#64748b', width: 28 }}>{overlayOpacity}%</span>
                </div>
              )}

              <button onClick={() => { setResult(null); setFile2Path('') }}
                style={{ marginLeft: 'auto', padding: '4px 12px', borderRadius: 6, border: '1px solid var(--th-border)', background: 'transparent', color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}>
                New Compare
              </button>
            </div>

            {/* Image views */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
              {viewMode === 'side' && (
                <>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRight: '1px solid var(--th-border)' }}>
                    <img src={result.file1.thumbnail} style={{ maxWidth: '95%', maxHeight: '95%', objectFit: 'contain' }} />
                  </div>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    <img src={result.file2.thumbnail} style={{ maxWidth: '95%', maxHeight: '95%', objectFit: 'contain' }} />
                  </div>
                </>
              )}

              {viewMode === 'diff' && result.diffImage && (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  <img src={result.diffImage} style={{ maxWidth: '95%', maxHeight: '95%', objectFit: 'contain' }} />
                  <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', padding: '4px 12px', borderRadius: 6, background: 'rgba(0,0,0,0.8)', fontSize: 11, color: '#ef4444' }}>
                    Κόκκινο = pixel differences
                  </div>
                </div>
              )}

              {viewMode === 'overlay' && (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
                  <img src={result.file1.thumbnail} style={{ maxWidth: '95%', maxHeight: '95%', objectFit: 'contain', position: 'absolute' }} />
                  <img src={result.file2.thumbnail} style={{ maxWidth: '95%', maxHeight: '95%', objectFit: 'contain', position: 'absolute', opacity: overlayOpacity / 100 }} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
