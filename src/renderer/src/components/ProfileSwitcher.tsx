import { useEffect, useState, useRef, type CSSProperties } from 'react'
import { ChevronDown, Plus, Settings, Check, Loader2 } from 'lucide-react'

const DEFAULT_PRESSCAL_BASE = 'https://demo.gr.presscal.com'

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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function Avatar({ profile, size = 24 }: { profile: Profile; size?: number }) {
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    background: profile.color,
    color: '#fff',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: Math.round(size * 0.42),
    fontWeight: 600,
    flexShrink: 0,
  }
  return <span style={style}>{initials(profile.name)}</span>
}

function formatHost(url?: string): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function ProfileSwitcher({ onManage }: { onManage?: () => void }) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [active, setActive] = useState<Profile | null>(null)
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const load = async () => {
    const [list, current] = await Promise.all([
      window.api.profiles.list(),
      window.api.profiles.active(),
    ])
    setProfiles(list as Profile[])
    setActive(current as Profile | null)
  }

  useEffect(() => {
    void load()
  }, [])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (!active) return null

  const handleSwitch = async (id: string) => {
    if (id === active.id) {
      setOpen(false)
      return
    }
    if (!confirm(`Αλλαγή profile σε «${profiles.find(p => p.id === id)?.name}»;\n\nΤο PressKit θα επανεκκινηθεί.`)) return
    await window.api.profiles.switch(id)
    // The main process calls app.relaunch() — UI freezes momentarily.
  }

  const handleAdd = async () => {
    setAdding(true)
    setOpen(false)
    // Open the PressCal sign-in flow in browser. The deep-link handler will
    // recognize the special "addProfile=1" parameter and create a new profile
    // instead of overwriting the active one.
    const baseUrl = (active.presscalUrl?.trim() || DEFAULT_PRESSCAL_BASE).replace(/\/$/, '')
    void window.api.shell.openExternal(`${baseUrl}/auth/presskit-link?addProfile=1`)
    setTimeout(() => setAdding(false), 2000)
  }

  const sorted = [...profiles].sort((a, b) => b.lastUsedAt - a.lastUsedAt)

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title={`${active.name} · ${formatHost(active.presscalUrl) || 'no server'}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 8px 4px 4px',
          borderRadius: 18,
          background: 'transparent',
          border: '1px solid var(--th-border)',
          cursor: 'pointer',
          minHeight: 32,
          color: 'var(--th-text-primary)',
          fontSize: 12,
          maxWidth: 180,
        }}
      >
        <Avatar profile={active} size={22} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{active.name}</span>
        <ChevronDown size={12} style={{ opacity: 0.6, flexShrink: 0 }} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            right: 0,
            marginBottom: 6,
            minWidth: 280,
            background: 'var(--th-bg-secondary)',
            border: '1px solid var(--th-border)',
            borderRadius: 10,
            boxShadow: '0 8px 24px var(--th-shadow)',
            zIndex: 1000,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--th-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Profiles
          </div>
          {sorted.map(p => {
            const isActive = p.id === active.id
            return (
              <button
                key={p.id}
                onClick={() => handleSwitch(p.id)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  background: isActive ? 'var(--th-accent-subtle)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: 'var(--th-text-primary)',
                  borderBottom: '1px solid var(--th-border)',
                  minHeight: 'auto',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--th-bg-hover)' }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
              >
                <Avatar profile={p} size={28} />
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--th-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {formatHost(p.presscalUrl) || 'not configured'}
                  </div>
                </div>
                {isActive && <Check size={14} style={{ color: 'var(--th-accent)', flexShrink: 0 }} />}
              </button>
            )
          })}

          <button
            onClick={handleAdd}
            disabled={adding}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
              color: 'var(--th-accent)',
              fontSize: 13,
              minHeight: 'auto',
              borderBottom: '1px solid var(--th-border)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--th-bg-hover)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Προσθήκη profile
          </button>

          {onManage && (
            <button
              onClick={() => { setOpen(false); onManage() }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                color: 'var(--th-text-secondary)',
                fontSize: 12,
                minHeight: 'auto',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--th-bg-hover)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <Settings size={14} />
              Διαχείριση profiles
            </button>
          )}
        </div>
      )}
    </div>
  )
}
