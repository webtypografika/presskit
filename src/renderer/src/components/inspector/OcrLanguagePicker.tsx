import { useEffect, useState, useMemo } from 'react'
import { Plus, Trash2, Loader2, FolderOpen, Search, X } from 'lucide-react'
import {
  listOcrLanguages, installOcrLanguage, uninstallOcrLanguage, revealOcrLanguages,
  DEFAULT_LANG, type OcrLanguage,
} from '@/lib/extract-text'

/**
 * Choose the language OCR reads in, and manage which ones are on this machine.
 *
 * Two things this exists to prevent. One: a hard-coded shortlist, which is a
 * guess about the customer's market that is wrong as soon as we sell outside
 * it. Two: a hundred-item dropdown, which is the same thing as no list at all.
 *
 * So the picker only ever offers what is actually installed — a language that
 * is not on disk cannot read anything, and offering it would produce an empty
 * result that looks like a broken feature — and adding one is a separate,
 * deliberate step behind "Manage".
 *
 * More than one can be on at once, and usually should be. Greek data alone
 * cannot read the Latin alphabet: on a real flyer it turned the telephone
 * number into "(οθ99007" while English data read the same digits perfectly.
 * Artwork is bilingual even when the copy is not.
 *
 * Sizes are shown because these are real files on the operator's own disk.
 * Software that quietly accumulates hundreds of megabytes somewhere hidden is
 * software a print shop stops trusting.
 */
export function OcrLanguagePicker({
  value,
  onChange,
  disabled,
}: {
  value: string[]
  onChange: (codes: string[]) => void
  disabled?: boolean
}) {
  const [langs, setLangs] = useState<OcrLanguage[]>([])
  const [managing, setManaging] = useState(false)
  const [query, setQuery] = useState('')
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    try {
      setLangs(await listOcrLanguages())
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => { refresh() }, [])

  const installed = useMemo(() => langs.filter(l => l.installed), [langs])

  // If a chosen language gets removed, drop it rather than reading with data
  // that is no longer there — and never end up with nothing selected.
  useEffect(() => {
    if (!installed.length) return
    const alive = value.filter(c => installed.some(l => l.code === c))
    if (alive.length !== value.length) onChange(alive.length ? alive : [DEFAULT_LANG])
  }, [installed, value, onChange])

  const toggle = (code: string) => {
    const next = value.includes(code) ? value.filter(c => c !== code) : [...value, code]
    // Reading with no language is not a state worth allowing.
    onChange(next.length ? next : [code])
  }

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pool = q
      ? langs.filter(l => l.name.toLowerCase().includes(q) || l.code.includes(q))
      : langs.filter(l => l.installed)
    // Installed first, then alphabetically — what you have, then what you could add.
    return [...pool].sort((a, b) =>
      Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name))
  }, [langs, query])

  const act = async (code: string, install: boolean) => {
    setWorking(code); setError(null)
    try {
      const res = install ? await installOcrLanguage(code) : await uninstallOcrLanguage(code)
      if (!res.ok) setError(res.error || 'Failed.')
      else {
        await refresh()
        // A language you just went and fetched is one you meant to read with.
        if (install && !value.includes(code)) onChange([...value, code])
      }
    } finally {
      setWorking(null)
    }
  }

  const totalMb = installed.reduce((n, l) => n + l.size, 0) / 1048576

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 5,
      }}>
        <span style={{
          fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', color: '#64748b',
        }}>
          TEXT LANGUAGE
        </span>
        <button
          onClick={() => setManaging(m => !m)}
          disabled={disabled}
          style={{
            background: 'none', border: 'none', padding: 0, fontSize: 10.5,
            color: '#64748b', textDecoration: 'underline',
            cursor: disabled ? 'default' : 'pointer',
          }}
        >
          {managing ? 'Done' : 'Manage'}
        </button>
      </div>

      {installed.length === 0 ? (
        <div style={{ fontSize: 11.5, color: '#64748b', padding: '6px 0' }}>
          No language installed — press Manage.
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {installed.map(l => {
            const on = value.includes(l.code)
            return (
              <button
                key={l.code}
                onClick={() => toggle(l.code)}
                disabled={disabled}
                title={on ? `Stop reading ${l.name}` : `Also read ${l.name}`}
                style={{
                  padding: '4px 9px', fontSize: 11.5, borderRadius: 999,
                  border: '1px solid ' + (on ? 'var(--accent)' : 'var(--border)'),
                  background: on ? 'var(--accent)' : 'transparent',
                  color: on ? '#04252b' : '#94a3b8',
                  fontWeight: on ? 600 : 400,
                  cursor: disabled ? 'wait' : 'pointer',
                }}
              >
                {l.name}
              </button>
            )
          })}
        </div>
      )}

      {!managing && (
        <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 5, lineHeight: 1.45 }}>
          Keep English on alongside your own language: telephone numbers, e-mail
          and web addresses are Latin even on artwork that is not.
          {installed.length === 1 && ' Press Manage to add your language.'}
        </div>
      )}

      {managing && (
        <div style={{
          marginTop: 8, padding: 8, borderRadius: 6,
          background: 'var(--bg)', border: '1px solid var(--border)',
        }}>
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <Search
              size={12}
              style={{ position: 'absolute', left: 8, top: 8, color: '#64748b' }}
            />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search 100+ languages…"
              style={{
                width: '100%', padding: '6px 8px 6px 25px', fontSize: 11.5,
                background: 'var(--bg-hover)', color: 'var(--text-primary)',
                border: '1px solid var(--border)', borderRadius: 5,
              }}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                style={{
                  position: 'absolute', right: 6, top: 6, background: 'none',
                  border: 'none', padding: 2, color: '#64748b', cursor: 'pointer',
                }}
              >
                <X size={11} />
              </button>
            )}
          </div>

          {error && (
            <div style={{
              fontSize: 11, color: '#fca5a5', marginBottom: 8, lineHeight: 1.45,
            }}>
              {error}
            </div>
          )}

          <div style={{ maxHeight: 220, overflowY: 'auto', marginBottom: 8 }}>
            {matches.length === 0 && (
              <div style={{ fontSize: 11.5, color: '#64748b', padding: '6px 2px' }}>
                Nothing matches “{query}”.
              </div>
            )}
            {matches.map(l => (
              <div
                key={l.code}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '5px 2px', fontSize: 11.5,
                  color: l.installed ? 'var(--text-primary)' : '#94a3b8',
                }}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {l.name}
                </span>
                {l.installed && l.size > 0 && (
                  <span style={{ fontSize: 10, color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>
                    {(l.size / 1048576).toFixed(1)} MB
                  </span>
                )}
                {working === l.code ? (
                  <Loader2 size={12} className="animate-spin" style={{ color: '#64748b' }} />
                ) : l.installed ? (
                  l.permanent ? (
                    <span style={{ fontSize: 10, color: '#64748b' }}>built in</span>
                  ) : (
                    <button
                      onClick={() => act(l.code, false)}
                      title={`Remove ${l.name}`}
                      style={iconBtn}
                    >
                      <Trash2 size={12} />
                    </button>
                  )
                ) : (
                  <button
                    onClick={() => act(l.code, true)}
                    title={`Add ${l.name}`}
                    style={iconBtn}
                  >
                    <Plus size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            paddingTop: 7, borderTop: '1px solid var(--border)',
            fontSize: 10.5, color: '#64748b',
          }}>
            <span>
              {installed.length} installed · {totalMb.toFixed(1)} MB
            </span>
            <button
              onClick={() => revealOcrLanguages()}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, background: 'none',
                border: 'none', padding: 0, fontSize: 10.5, color: '#64748b',
                cursor: 'pointer',
              }}
            >
              <FolderOpen size={11} /> Open folder
            </button>
          </div>

          <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 7, lineHeight: 1.45 }}>
            Each language is downloaded once (1–3 MB) and then works offline.
          </div>
        </div>
      )}
    </div>
  )
}

const iconBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 20, height: 20, padding: 0, borderRadius: 4,
  background: 'transparent', border: '1px solid var(--border)',
  color: '#94a3b8', cursor: 'pointer', flexShrink: 0,
}
