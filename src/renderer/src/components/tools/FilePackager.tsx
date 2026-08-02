import { useState, useCallback } from 'react'
import { useAppStore } from '@/stores/app-store'
import { Package, FolderOpen, Loader2, Check, AlertTriangle, Copy, Move } from 'lucide-react'

const FILE_TYPE_GROUPS = [
  { label: 'PDF', extensions: ['.pdf'] },
  { label: 'InDesign', extensions: ['.indd', '.idml'] },
  { label: 'Illustrator', extensions: ['.ai', '.eps', '.epsf'] },
  { label: 'Photoshop', extensions: ['.psd', '.psb'] },
  { label: 'Images', extensions: ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.bmp', '.gif', '.svg'] },
  { label: 'RAW', extensions: ['.cr2', '.cr3', '.nef', '.arw', '.dng', '.raf', '.orf', '.rw2'] },
  { label: 'Fonts', extensions: ['.otf', '.ttf', '.woff', '.woff2'] },
  { label: 'Documents', extensions: ['.doc', '.docx', '.txt', '.rtf', '.xls', '.xlsx', '.csv'] },
  { label: 'Archives', extensions: ['.zip', '.rar', '.7z'] },
]

export function FilePackager({ onClose }: { onClose: () => void }) {
  const currentPath = useAppStore(s => s.currentPath)
  const [selected, setSelected] = useState<Set<number>>(new Set([0])) // PDF selected by default
  const [moveMode, setMoveMode] = useState(false)
  const [targetDir, setTargetDir] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ processed: number; errors: string[] } | null>(null)

  const toggleGroup = (idx: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const selectAll = () => setSelected(new Set(FILE_TYPE_GROUPS.map((_, i) => i)))
  const selectNone = () => setSelected(new Set())

  const pickTarget = useCallback(async () => {
    const dir = await window.api.dialog.openDirectory()
    if (dir) setTargetDir(dir)
  }, [])

  const doCollect = useCallback(async () => {
    if (!targetDir || !currentPath || selected.size === 0) return
    const extensions = Array.from(selected).flatMap(i => FILE_TYPE_GROUPS[i].extensions)
    setRunning(true)
    setResult(null)
    try {
      const res = await window.api.tools.collectByType(currentPath, extensions, targetDir, moveMode)
      setResult(res)
    } catch (err) {
      setResult({ processed: 0, errors: [String(err)] })
    }
    setRunning(false)
  }, [targetDir, currentPath, selected, moveMode])

  const selectedExtCount = Array.from(selected).reduce((sum, i) => sum + FILE_TYPE_GROUPS[i].extensions.length, 0)

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60,
      background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: 460, background: 'var(--th-bg-secondary)', borderRadius: 14,
        border: '1px solid var(--th-border)', display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--th-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Package size={18} style={{ color: 'var(--th-accent)' }} />
          <span style={{ fontSize: 15, fontWeight: 600, flex: 1, color: 'var(--th-text-primary)' }}>Collect Files</span>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: 'var(--th-text-muted)', cursor: 'pointer', fontSize: 18 }}>&times;</button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Source */}
          <div style={{ fontSize: 12, color: 'var(--th-text-muted)' }}>
            From: <span style={{ fontFamily: 'monospace', color: 'var(--th-text-secondary)' }}>{currentPath}</span>
          </div>

          {/* File type checkboxes */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--th-text-muted)', fontWeight: 600, flex: 1 }}>File types</span>
              <button onClick={selectAll} style={{ border: 'none', background: 'transparent', color: 'var(--th-accent)', cursor: 'pointer', fontSize: 11 }}>All</button>
              <button onClick={selectNone} style={{ border: 'none', background: 'transparent', color: 'var(--th-text-muted)', cursor: 'pointer', fontSize: 11 }}>None</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {FILE_TYPE_GROUPS.map((group, idx) => {
                const isOn = selected.has(idx)
                return (
                  <button
                    key={group.label}
                    onClick={() => toggleGroup(idx)}
                    style={{
                      padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                      border: `1px solid ${isOn ? 'var(--th-accent)' : 'var(--th-border)'}`,
                      background: isOn ? 'var(--th-accent-subtle)' : 'transparent',
                      color: isOn ? 'var(--th-accent)' : 'var(--th-text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    {group.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Copy / Move toggle */}
          <div style={{ display: 'flex', gap: 4, background: 'var(--th-bg-primary)', borderRadius: 8, padding: 3 }}>
            <button onClick={() => setMoveMode(false)} style={{
              flex: 1, padding: '6px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              background: !moveMode ? 'var(--th-accent-subtle)' : 'transparent',
              color: !moveMode ? 'var(--th-accent)' : 'var(--th-text-muted)',
            }}>
              <Copy size={13} /> Copy
            </button>
            <button onClick={() => setMoveMode(true)} style={{
              flex: 1, padding: '6px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              background: moveMode ? 'var(--th-accent-subtle)' : 'transparent',
              color: moveMode ? 'var(--th-accent)' : 'var(--th-text-muted)',
            }}>
              <Move size={13} /> Move
            </button>
          </div>

          {/* Target folder */}
          <div>
            <label style={{ fontSize: 11, color: 'var(--th-text-muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
              Destination folder
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={targetDir}
                onChange={e => setTargetDir(e.target.value)}
                placeholder="Select a folder..."
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
                <FolderOpen size={14} />
              </button>
            </div>
          </div>

          {/* Action button */}
          <button
            onClick={doCollect}
            disabled={!targetDir || running || selected.size === 0}
            style={{
              padding: '10px 16px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600,
              background: result ? '#22c55e' : 'var(--th-accent)', color: '#fff', cursor: 'pointer',
              opacity: !targetDir || running || selected.size === 0 ? 0.5 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : result ? <Check size={14} /> : <Package size={14} />}
            {running
              ? 'Working...'
              : result
                ? `${result.processed} files ${moveMode ? 'moved' : 'copied'}!`
                : `${moveMode ? 'Move' : 'Copy'} (${selectedExtCount} types)`}
          </button>

          {/* Errors */}
          {result && result.errors.length > 0 && (
            <div style={{ padding: '8px 10px', borderRadius: 6, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <AlertTriangle size={12} style={{ color: '#ef4444' }} />
                <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>{result.errors.length} errors</span>
              </div>
              {result.errors.slice(0, 5).map((err, i) => (
                <div key={i} style={{ fontSize: 11, color: 'var(--th-text-muted)' }}>{err}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
