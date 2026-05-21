import { useState, useEffect } from 'react'
import { useAppStore } from '@/stores/app-store'
import { History, FileText, Loader2, ExternalLink } from 'lucide-react'

interface FileVersion {
  path: string
  name: string
  size: number
  modified: string
  isCurrent: boolean
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function VersionHistory() {
  const { selectedFile, selectFile, navigateTo } = useAppStore()
  const [versions, setVersions] = useState<FileVersion[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!selectedFile?.path || selectedFile.isDirectory) {
      setVersions([])
      return
    }

    setLoading(true)
    window.api.tools.getVersions(selectedFile.path)
      .then(result => setVersions(result))
      .catch(() => setVersions([]))
      .finally(() => setLoading(false))
  }, [selectedFile?.path])

  if (!selectedFile || selectedFile.isDirectory) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <History size={28} style={{ color: '#475569', margin: '0 auto 8px' }} />
        <div style={{ fontSize: 12, color: '#64748b' }}>Επιλέξτε αρχείο</div>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <Loader2 size={20} className="animate-spin" style={{ color: 'var(--th-accent)', margin: '0 auto 8px' }} />
      </div>
    )
  }

  if (versions.length <= 1) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <History size={28} style={{ color: '#475569', margin: '0 auto 8px' }} />
        <div style={{ fontSize: 12, color: '#64748b' }}>Δεν βρέθηκαν παλαιότερες εκδόσεις</div>
        <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
          Αναζήτηση patterns: _v1, _v2, (1), (2), _final, _revised
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        {versions.length} εκδόσεις
      </div>

      {versions.map((v, i) => (
        <div
          key={v.path}
          style={{
            padding: '10px 12px', borderRadius: 8,
            background: v.isCurrent ? 'rgba(110,200,200,0.08)' : 'var(--th-bg-primary)',
            border: `1px solid ${v.isCurrent ? 'rgba(110,200,200,0.3)' : 'var(--th-border)'}`,
            display: 'flex', alignItems: 'center', gap: 10,
            cursor: 'pointer',
          }}
          onClick={() => {
            if (!v.isCurrent) {
              selectFile({
                name: v.name,
                path: v.path,
                isDirectory: false,
                size: v.size,
                modified: v.modified,
                created: '',
                extension: '.' + v.name.split('.').pop()?.toLowerCase(),
                type: selectedFile.type,
              })
            }
          }}
        >
          {/* Timeline line */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            <div style={{
              width: 10, height: 10, borderRadius: '50%',
              background: v.isCurrent ? 'var(--th-accent)' : i === 0 ? '#22c55e' : '#475569',
              border: `2px solid ${v.isCurrent ? 'var(--th-accent)' : i === 0 ? '#22c55e' : '#475569'}`,
            }} />
            {i < versions.length - 1 && (
              <div style={{ width: 2, height: 20, background: '#1e293b' }} />
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <FileText size={13} style={{ color: v.isCurrent ? 'var(--th-accent)' : '#64748b', flexShrink: 0 }} />
              <span style={{
                fontSize: 13, fontWeight: v.isCurrent ? 600 : 400,
                color: v.isCurrent ? 'var(--th-accent)' : 'var(--th-text-primary)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {v.name}
              </span>
              {v.isCurrent && (
                <span style={{ fontSize: 10, color: 'var(--th-accent)', background: 'rgba(110,200,200,0.1)', padding: '1px 6px', borderRadius: 4 }}>current</span>
              )}
            </div>
            <div style={{ fontSize: 11, color: '#64748b', display: 'flex', gap: 8, marginTop: 2 }}>
              <span>{formatSize(v.size)}</span>
              <span>{new Date(v.modified).toLocaleDateString('el-GR')} {new Date(v.modified).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>

          {!v.isCurrent && (
            <button
              onClick={(e) => { e.stopPropagation(); window.api.shell.showInFolder(v.path) }}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b', padding: 4 }}
              title="Show in folder"
            >
              <ExternalLink size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
