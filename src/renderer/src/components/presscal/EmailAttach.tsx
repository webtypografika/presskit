import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useAppStore } from '@/stores/app-store'
import {
  Send, Paperclip, Loader2, CheckCircle, FileText, X
} from 'lucide-react'
import { formatFileSize } from '@/lib/file-types'
import { fuzzyMatch } from '@/lib/fuzzy'
import type { PresscalCustomer } from '@/lib/ipc'

export function EmailAttach() {
  const { selectedFile, selectedFiles, preflight } = useAppStore()
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [includePreflight, setIncludePreflight] = useState(false)

  // Collect files to attach: multi-selected or single selected
  const files = useMemo(() => {
    if (selectedFiles.length > 0) return selectedFiles.filter(f => !f.isDirectory)
    if (selectedFile && !selectedFile.isDirectory) return [selectedFile]
    return []
  }, [selectedFiles, selectedFile])

  const [excludedPaths, setExcludedPaths] = useState<Set<string>>(new Set())
  const attachedFiles = files.filter(f => !excludedPaths.has(f.path))

  const toggleFile = (path: string) => {
    setExcludedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  // Customer email autocomplete
  const [allCustomers, setAllCustomers] = useState<PresscalCustomer[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.api.presscal.getCustomers()
      .then(setAllCustomers)
      .catch(() => setAllCustomers([]))
  }, [])

  const suggestions = useMemo(() => {
    if (!to.trim() || to.includes('@') && to.includes('.')) return []
    return allCustomers
      .filter(c => {
        const text = [c.name, c.company, c.email].filter(Boolean).join(' ')
        return fuzzyMatch(text, to) && c.email
      })
      .slice(0, 6)
  }, [to, allCustomers])

  const selectCustomer = (customer: PresscalCustomer) => {
    setTo(customer.email || '')
    setShowSuggestions(false)
  }

  const handleSend = useCallback(async () => {
    if (!to || !subject) return
    setSending(true)
    setError('')
    setSent(false)

    try {
      const filePaths = attachedFiles.map(f => ({
        path: f.path,
        name: f.name,
        ext: f.extension
      }))

      await window.api.presscal.sendEmailWithFiles({
        to: to.trim(),
        subject: subject.trim(),
        body: body.trim(),
        filePaths
      })

      setSent(true)
      setTimeout(() => setSent(false), 3000)
    } catch (e: any) {
      setError(e.message || 'Failed to send email')
    } finally {
      setSending(false)
    }
  }, [to, subject, body, attachedFiles])

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    background: 'var(--th-bg-primary)', border: '1px solid var(--th-border)',
    color: 'var(--th-text-primary)', fontSize: 13, outline: 'none',
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Attached files */}
      {files.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--th-text-muted)', fontWeight: 600, marginBottom: 2 }}>
            Attachments ({attachedFiles.length})
          </div>
          {files.map(f => (
            <div
              key={f.path}
              className="flex items-center"
              style={{
                gap: 8, padding: '6px 10px', borderRadius: 6,
                background: excludedPaths.has(f.path) ? 'transparent' : 'var(--th-bg-primary)',
                opacity: excludedPaths.has(f.path) ? 0.4 : 1,
              }}
            >
              <Paperclip size={12} style={{ color: '#f58220', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--th-text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.name}
              </span>
              <span style={{ fontSize: 10, color: 'var(--th-text-muted)', flexShrink: 0 }}>
                {formatFileSize(f.size)}
              </span>
              <button
                onClick={() => toggleFile(f.path)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--th-text-muted)' }}
                title={excludedPaths.has(f.path) ? 'Include' : 'Exclude'}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Preflight report */}
      {preflight && (
        <label className="flex items-center cursor-pointer" style={{ gap: 8, padding: '6px 10px', borderRadius: 6 }}>
          <input type="checkbox" checked={includePreflight} onChange={e => setIncludePreflight(e.target.checked)} style={{ width: 14, height: 14, accentColor: '#f58220' }} />
          <FileText size={12} style={{ color: 'var(--th-text-muted)' }} />
          <span style={{ fontSize: 12, color: 'var(--th-text-secondary)' }}>Preflight report ({preflight.overallStatus})</span>
        </label>
      )}

      {/* Form */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* To field with autocomplete */}
        <div style={{ position: 'relative' }}>
          <input
            ref={inputRef}
            type="email"
            value={to}
            onChange={e => { setTo(e.target.value); setShowSuggestions(true) }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            placeholder="To: email or customer name..."
            style={inputStyle}
          />
          {showSuggestions && suggestions.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
              marginTop: 4, borderRadius: 8, overflow: 'hidden',
              background: 'var(--th-bg-secondary)', border: '1px solid var(--th-border)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            }}>
              {suggestions.map(c => (
                <div
                  key={c.id}
                  onMouseDown={() => selectCustomer(c)}
                  style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--th-border)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--th-bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <div style={{ fontSize: 12, color: 'var(--th-text-primary)', fontWeight: 500 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--th-text-muted)' }}>{c.email}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <input type="text" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" style={inputStyle} />
        <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Message..." rows={4} style={{ ...inputStyle, resize: 'vertical' }} />
      </div>

      {error && <div style={{ fontSize: 12, color: '#ef4444' }}>{error}</div>}

      <button
        onClick={handleSend}
        disabled={sending || !to || !subject}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 8, padding: '10px 16px', borderRadius: 8, border: 'none',
          background: sent ? '#22c55e' : '#f58220', color: '#fff',
          fontSize: 13, fontWeight: 600, cursor: sending ? 'default' : 'pointer',
          opacity: (sending || !to || !subject) ? 0.5 : 1,
        }}
      >
        {sending ? <><Loader2 size={14} className="animate-spin" /> Sending...</>
          : sent ? <><CheckCircle size={14} /> Sent!</>
          : <><Send size={14} /> Send via PressCal</>
        }
      </button>
    </div>
  )
}
