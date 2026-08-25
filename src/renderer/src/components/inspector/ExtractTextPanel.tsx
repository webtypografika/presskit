import { useState } from 'react'
import { Copy, Check, Download, FileText, Loader2, AlertTriangle } from 'lucide-react'
import { useAppStore } from '@/stores/app-store'
import { useDialogStore } from '@/stores/dialog-store'
import { extractText, resultToPlainText, type ExtractResult } from '@/lib/extract-text'

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

  const path = selectedFile?.path
  const supported = !!path && /\.(pdf|jpe?g|png|tiff?|bmp|webp)$/i.test(path)

  const run = async () => {
    if (!path) return
    setBusy(true); setProgress(0); setResult(null)
    try {
      setResult(await extractText(path, setProgress))
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
      <button
        onClick={run}
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
            background: result.method === 'text' ? 'rgba(34,197,94,0.10)' : 'rgba(234,179,8,0.10)',
            color: result.method === 'text' ? '#4ade80' : '#facc15',
          }}>
            {result.method === 'text' ? <Check size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                                      : <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />}
            <span>
              {result.method === 'text'
                ? <>Exact text, read from the file itself. Safe to copy as-is.</>
                : <>{result.warning}</>}
            </span>
          </div>

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
