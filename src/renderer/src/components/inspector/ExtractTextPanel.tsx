import { useState, useEffect, useCallback } from 'react'
import { Copy, Check, Download, FileText, Loader2, AlertTriangle, Sparkles, Info } from 'lucide-react'
import { useAppStore } from '@/stores/app-store'
import { useDialogStore } from '@/stores/dialog-store'
import {
  extractText, extractWithAi, resultToPlainText, listOcrLanguages, suggestedLangs,
  DEFAULT_LANG, type ExtractResult,
} from '@/lib/extract-text'
import { OcrLanguagePicker } from './OcrLanguagePicker'

/** The operator sets this once for their shop, not once per file. */
const LANG_KEY = 'presskit.ocrLang'

/**
 * Pull the text out of an incoming file so it can be rebuilt — locally.
 *
 * The point of doing it here rather than in a browser AI chat is twofold: the
 * customer's artwork never leaves the machine, and a PDF that carries live text
 * gives back the text EXACTLY. An AI reading the same file would paraphrase,
 * and a phone number read wrong gets printed five thousand times.
 *
 * Which method produced the text is therefore the most important thing on this
 * panel, not a footnote: 'text' can be copied straight into the new job, 'ocr'
 * is a draft that must be proofread.
 */
export function ExtractTextPanel() {
  const selectedFile = useAppStore(s => s.selectedFile)
  const showAlert = useDialogStore(s => s.showAlert)
  const [result, setResult] = useState<ExtractResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [copied, setCopied] = useState<number | 'all' | null>(null)
  const [langs, setLangs] = useState<string[]>(() => {
    const saved = localStorage.getItem(LANG_KEY)
    // Stored as a list since 2.3.22; a bare code is what older versions wrote.
    if (!saved) return [DEFAULT_LANG]
    try {
      const parsed = JSON.parse(saved)
      return Array.isArray(parsed) && parsed.length ? parsed : [DEFAULT_LANG]
    } catch {
      return [saved]
    }
  })

  const path = selectedFile?.path
  const supported = !!path && /\.(pdf|jpe?g|png|tiff?|bmp|webp)$/i.test(path)
  const isPdf = !!path && /[.]pdf$/i.test(path)

  const pickLangs = useCallback((next: string[]) => {
    setLangs(next)
    localStorage.setItem(LANG_KEY, JSON.stringify(next))
  }, [])

  // On a machine that has never chosen, offer the language the operating system
  // suggests — but only if its data is actually installed, since a language that
  // is not on disk would return nothing and read as a broken feature.
  useEffect(() => {
    if (localStorage.getItem(LANG_KEY)) return
    listOcrLanguages()
      .then(all => {
        const s = suggestedLangs(all)
        if (s.length > 1 || s[0] !== DEFAULT_LANG) pickLangs(s)
      })
      .catch(() => {})
  }, [pickLangs])

  const run = async (forceOcr = false) => {
    if (!path) return
    setBusy(true); setProgress(0); setResult(null)
    try {
      setResult(await extractText(path, setProgress, { langs, forceOcr }))
    } catch (e: any) {
      showAlert(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const runAi = async () => {
    if (!path) return
    setBusy(true); setProgress(0); setResult(null)
    try {
      setResult(await extractWithAi(path, setProgress))
    } catch (e: any) {
      showAlert(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const copy = async (text: string, key: number | 'all') => {
    await navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 1200)
  }

  const saveTxt = async () => {
    if (!result || !path) return
    const name = (path.split(/[\\/]/).pop() || 'extracted').replace(/\.[^.]+$/, '') + '.txt'
    try {
      const saved = await window.api.tools.saveText(resultToPlainText(result), name)
      if (saved) showAlert(`Saved:\n${saved}`)
    } catch (e: any) {
      showAlert(e?.message || String(e))
    }
  }

  if (!selectedFile) {
    return <div style={{ padding: 16, fontSize: 13, color: '#475569' }}>Select a file</div>
  }

  if (!supported) {
    return (
      <div style={{ padding: 16, fontSize: 13, color: '#94a3b8', lineHeight: 1.6 }}>
        Text can be read from <strong>PDF</strong> files and from <strong>images</strong> (JPG, PNG, TIFF).
        <br /><br />
        For an AI or InDesign file, export a PDF first — the text comes out exact that way.
      </div>
    )
  }

  const blockCount = result?.pages.reduce((n, p) => n + p.blocks.length, 0) ?? 0

  return (
    <div style={{ padding: 12, minWidth: 0 }}>
      <OcrLanguagePicker value={langs} onChange={pickLangs} disabled={busy} />

      <button
        onClick={() => run()}
        disabled={busy}
        className="w-full flex items-center justify-center gap-2 rounded-md transition-colors"
        style={{
          padding: '10px 12px', fontSize: 13, fontWeight: 600,
          background: busy ? 'var(--bg-hover)' : 'var(--accent)',
          color: busy ? '#94a3b8' : '#04252b',
          border: 'none', cursor: busy ? 'wait' : 'pointer',
        }}
      >
        {busy
          ? <><Loader2 size={14} className="animate-spin" />{progress > 0 ? `Reading… ${progress}%` : 'Reading…'}</>
          : <><FileText size={14} />{result ? 'Read again' : 'Read the text'}</>}
      </button>

      {/* The second reading. OCR matches letter shapes and cannot tell that six
          captions side by side are six columns; a model that sees the page can.
          It costs the shop directly — their own key, never our plan — so it is a
          deliberate second press, not the default. */}
      <button
        onClick={runAi}
        disabled={busy}
        className="w-full flex items-center justify-center gap-2 rounded-md transition-colors"
        style={{
          marginTop: 8, padding: '9px 12px', fontSize: 12.5, fontWeight: 600,
          background: 'transparent', color: busy ? '#64748b' : 'var(--text-secondary)',
          border: '1px solid var(--border)', cursor: busy ? 'wait' : 'pointer',
        }}
      >
        <Sparkles size={13} /> Read with AI
      </button>
      <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 5, lineHeight: 1.45 }}>
        Handles columns and designed layouts. Uses your own AI key — not your PressCal plan.
      </div>

      {busy && progress > 0 && (
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 8, lineHeight: 1.5 }}>
          Recognising text from the image. The first run also downloads the language data, so it takes longer.
        </div>
      )}

      {result && (
        <>
          {/* How this text was produced — the thing that decides whether you
              trust it verbatim or proofread it. */}
          <div style={{
            marginTop: 12, padding: '8px 10px', borderRadius: 6, fontSize: 11.5, lineHeight: 1.5,
            display: 'flex', gap: 8, alignItems: 'flex-start',
            background: result.method === 'text' ? 'rgba(34,197,94,0.10)'
                      : result.method === 'ai' ? 'rgba(99,102,241,0.12)'
                      : 'rgba(234,179,8,0.10)',
            color: result.method === 'text' ? '#4ade80'
                 : result.method === 'ai' ? '#a5b4fc'
                 : '#facc15',
          }}>
            {result.method === 'text' ? <Check size={13} style={{ flexShrink: 0, marginTop: 1 }} />
             : result.method === 'ai' ? <Sparkles size={13} style={{ flexShrink: 0, marginTop: 1 }} />
             : <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />}
            <span>
              {result.method === 'text'
                ? <>Exact text, read from the file itself. Safe to copy as-is.</>
                : <>{result.warning}</>}
            </span>
          </div>

          {/* A PDF whose fonts were subset without a ToUnicode map hands back
              text that is technically exact and completely unreadable. There is
              no way to detect that reliably, so give the operator the way out. */}
          {result.method === 'text' && isPdf && (
            <button
              onClick={() => run(true)}
              disabled={busy}
              style={{
                marginTop: 8, padding: 0, background: 'none', border: 'none',
                fontSize: 11, color: '#64748b', textDecoration: 'underline',
                cursor: busy ? 'wait' : 'pointer',
              }}
            >
              Text looks wrong? Read it from the image instead
            </button>
          )}
          {blockCount > 0 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <button
                onClick={() => copy(resultToPlainText(result), 'all')}
                style={btnStyle}
              >
                {copied === 'all' ? <Check size={12} /> : <Copy size={12} />} Copy all
              </button>
              <button onClick={saveTxt} style={btnStyle}>
                <Download size={12} /> Save .txt
              </button>
            </div>
          )}

          {blockCount === 0 && (
            <div style={{ marginTop: 12, fontSize: 12.5, color: '#94a3b8', lineHeight: 1.6 }}>
              Nothing readable came out. If this is a photo, a straighter and sharper shot usually fixes it.
            </div>
          )}

          {result.pages.map(page => (
            <div key={page.page} style={{ marginTop: 14 }}>
              {result.pages.length > 1 && (
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 6, letterSpacing: '0.04em' }}>
                  PAGE {page.page}
                </div>
              )}
              {page.blocks.map((b, i) => {
                const key = page.page * 1000 + i
                return (
                  <div
                    key={i}
                    style={{
                      position: 'relative', marginBottom: 8, padding: '9px 30px 9px 10px',
                      background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
                      fontSize: 12.5, lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {b.text}
                    {b.note && (
                      <div style={{
                        display: 'flex', gap: 5, alignItems: 'flex-start',
                        marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)',
                        fontSize: 11, color: '#94a3b8', lineHeight: 1.45,
                      }}>
                        <Info size={11} style={{ flexShrink: 0, marginTop: 2 }} />
                        <span>{b.note}</span>
                      </div>
                    )}
                    <button
                      onClick={() => copy(b.text, key)}
                      title="Copy this block"
                      style={{
                        position: 'absolute', top: 6, right: 6, width: 20, height: 20,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'transparent', border: 'none', borderRadius: 4,
                        color: copied === key ? '#4ade80' : '#64748b', cursor: 'pointer', padding: 0,
                      }}
                    >
                      {copied === key ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
  padding: '7px 10px', fontSize: 11.5, fontWeight: 600,
  background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 6,
  color: 'var(--text-secondary)', cursor: 'pointer',
}
