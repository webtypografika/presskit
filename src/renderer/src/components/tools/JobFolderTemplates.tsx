import { useState, useEffect } from 'react'
import { useAppStore } from '@/stores/app-store'
import { FolderPlus, Check, FolderOpen, ChevronRight } from 'lucide-react'

interface FolderTemplate {
  name: string
  folders: string[]
}

export function JobFolderTemplates() {
  const { currentPath, navigateTo } = useAppStore()
  const [templates, setTemplates] = useState<FolderTemplate[]>([])
  const [selected, setSelected] = useState<string>('')
  const [jobName, setJobName] = useState('')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState('')

  useEffect(() => {
    window.api.tools.getFolderTemplates().then(setTemplates).catch(() => {})
  }, [])

  const handleCreate = async () => {
    if (!jobName.trim() || !selected || !currentPath) return
    setCreating(true)
    try {
      const path = await window.api.tools.createJobFolders(currentPath, selected, jobName.trim())
      setCreated(path)
      setTimeout(() => {
        navigateTo(path)
        setCreated('')
        setJobName('')
      }, 1500)
    } catch (err) {
      console.error('Create folders error:', err)
    }
    setCreating(false)
  }

  const selectedTemplate = templates.find(t => t.name === selected)

  const inp: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: 8,
    background: 'var(--th-bg-primary)', border: '1px solid var(--th-border)',
    color: 'var(--th-text-primary)', fontSize: 13, outline: 'none',
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Template
      </div>

      {/* Template cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {templates.map(t => (
          <button
            key={t.name}
            onClick={() => setSelected(t.name)}
            style={{
              padding: '10px 12px', borderRadius: 8, textAlign: 'left',
              border: `1px solid ${selected === t.name ? '#6ec8c8' : 'var(--th-border)'}`,
              background: selected === t.name ? 'rgba(110,200,200,0.08)' : 'var(--th-bg-primary)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
              color: 'var(--th-text-primary)',
            }}
          >
            <FolderPlus size={16} style={{ color: selected === t.name ? '#6ec8c8' : '#64748b', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{t.name}</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>{t.folders.length} φάκελοι</div>
            </div>
            {selected === t.name && <Check size={14} style={{ color: '#6ec8c8' }} />}
          </button>
        ))}
      </div>

      {/* Preview selected template */}
      {selectedTemplate && (
        <div style={{ padding: 10, borderRadius: 8, background: 'var(--th-bg-primary)', border: '1px solid var(--th-border)', maxHeight: 160, overflowY: 'auto' }}>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 6 }}>Δομή φακέλων:</div>
          {selectedTemplate.folders.map((f, i) => {
            const depth = f.split('/').length - 1
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0', paddingLeft: depth * 16 }}>
                {depth > 0 && <ChevronRight size={10} style={{ color: '#475569' }} />}
                <FolderOpen size={12} style={{ color: '#6ec8c8' }} />
                <span style={{ fontSize: 12, color: '#cbd5e1' }}>{f.split('/').pop()}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Job name input */}
      {selected && (
        <>
          <div>
            <label style={{ fontSize: 11, color: '#64748b', fontWeight: 600, display: 'block', marginBottom: 4 }}>
              Όνομα εργασίας
            </label>
            <input
              value={jobName}
              onChange={e => setJobName(e.target.value)}
              placeholder="π.χ. Κατάλογος_2026_Papasotiriou"
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              style={inp}
            />
          </div>

          <div style={{ fontSize: 11, color: '#475569' }}>
            Φάκελος: <span style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{currentPath}/{jobName || '...'}</span>
          </div>

          <button
            onClick={handleCreate}
            disabled={!jobName.trim() || creating}
            style={{
              padding: '10px 16px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600,
              background: created ? '#22c55e' : '#6ec8c8', color: '#fff', cursor: 'pointer',
              opacity: !jobName.trim() || creating ? 0.5 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {created ? <><Check size={14} /> Δημιουργήθηκε!</> : <><FolderPlus size={14} /> Δημιουργία Φακέλων</>}
          </button>
        </>
      )}
    </div>
  )
}
