import { useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { X, Pencil, Trash2, Check } from 'lucide-react'

interface Profile {
  id: string
  name: string
  email?: string
  presscalUrl?: string
  orgName?: string
  color: string
  createdAt: number
  lastUsedAt: number
}

const PROFILE_COLORS = [
  'var(--th-accent)', '#00707c', '#10b981', '#f59e0b',
  '#3b82f6', '#a78bfa', '#f06548', '#ec4899',
]

function formatHost(url?: string): string {
  if (!url) return 'not connected'
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

export function ManageProfilesDialog({ onClose }: { onClose: () => void }) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [activeId, setActiveId] = useState<string>('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')

  const load = async () => {
    const [list, current] = await Promise.all([
      window.api.profiles.list(),
      window.api.profiles.active(),
    ])
    setProfiles(list as Profile[])
    setActiveId((current as Profile)?.id ?? '')
  }

  useEffect(() => { void load() }, [])

  const startEdit = (p: Profile) => {
    setEditingId(p.id)
    setEditName(p.name)
    setEditColor(p.color)
  }

  const saveEdit = async () => {
    if (!editingId) return
    await window.api.profiles.update(editingId, { name: editName.trim() || 'Profile', color: editColor })
    setEditingId(null)
    void load()
  }

  const handleDelete = async (p: Profile) => {
    if (p.id === activeId) {
      alert('You cannot delete the active profile. Switch to another profile first.')
      return
    }
    if (profiles.length <= 1) {
      alert('You cannot delete the last profile.')
      return
    }
    if (!confirm(`Delete profile "${p.name}"?\n\nThis profile's settings and local bookmarks/picks will be lost. Files on disk are not affected.`)) return
    const res = await window.api.profiles.delete(p.id)
    if (!res?.ok) alert(res?.error || 'Failed to delete profile')
    void load()
  }

  const overlay: CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 9999,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.5)', padding: 32,
  }
  const card: CSSProperties = {
    width: '100%', maxWidth: 560,
    background: 'var(--th-bg-secondary)', border: '1px solid var(--th-border)',
    borderRadius: 14, overflow: 'hidden', maxHeight: '80vh',
    display: 'flex', flexDirection: 'column',
  }

  return createPortal(
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--th-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--th-text-primary)' }}>Manage profiles</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--th-text-muted)', minHeight: 'auto', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: '8px 0' }}>
          {profiles.map(p => {
            const isEditing = editingId === p.id
            const isActive = p.id === activeId
            return (
              <div
                key={p.id}
                style={{
                  padding: '14px 24px',
                  borderBottom: '1px solid var(--th-border)',
                  display: 'flex',
                  gap: 14,
                  alignItems: 'flex-start',
                }}
              >
                <span style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: isEditing ? editColor : p.color,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 14, fontWeight: 600, flexShrink: 0,
                }}>
                  {(isEditing ? editName : p.name).slice(0, 2).toUpperCase()}
                </span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  {isEditing ? (
                    <>
                      <input
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        autoFocus
                        style={{ marginBottom: 8 }}
                      />
                      <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                        {PROFILE_COLORS.map(c => (
                          <button
                            key={c}
                            onClick={() => setEditColor(c)}
                            style={{
                              width: 22, height: 22, borderRadius: '50%',
                              background: c, border: editColor === c ? '2px solid var(--th-text-primary)' : '2px solid transparent',
                              cursor: 'pointer', minHeight: 'auto', padding: 0,
                            }}
                          />
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--th-text-primary)' }}>
                        {p.name}
                        {isActive && (
                          <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--th-accent)', fontWeight: 600 }}>
                            (active)
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--th-text-muted)' }}>
                        {p.email && <>{p.email} · </>}{formatHost(p.presscalUrl)}
                      </div>
                    </>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 4 }}>
                  {isEditing ? (
                    <>
                      <button onClick={saveEdit} title="Save" style={iconBtn('var(--th-accent)')}>
                        <Check size={14} />
                      </button>
                      <button onClick={() => setEditingId(null)} title="Cancel" style={iconBtn('var(--th-text-muted)')}>
                        <X size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => startEdit(p)} title="Rename" style={iconBtn('var(--th-text-muted)')}>
                        <Pencil size={14} />
                      </button>
                      {!isActive && profiles.length > 1 && (
                        <button onClick={() => handleDelete(p)} title="Delete" style={iconBtn('#dc2626')}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--th-border)', fontSize: 12, color: 'var(--th-text-muted)' }}>
          To create a new profile, use the switcher at the bottom right → "+ Add profile".
        </div>
      </div>
    </div>,
    document.body
  )
}

function iconBtn(color: string): CSSProperties {
  return {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color,
    padding: 6,
    borderRadius: 6,
    minHeight: 'auto',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  }
}
