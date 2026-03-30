import { useState, useCallback } from 'react'
import { useAppStore } from '@/stores/app-store'
import {
  Send, Paperclip, Loader2, CheckCircle, FileText
} from 'lucide-react'
import { formatFileSize } from '@/lib/file-types'

export function EmailAttach() {
  const { selectedFile, preflight } = useAppStore()
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [includeFile, setIncludeFile] = useState(true)
  const [includePreflight, setIncludePreflight] = useState(false)

  const handleSend = useCallback(async () => {
    if (!to || !subject) return
    setSending(true)
    setError('')
    setSent(false)

    try {
      const attachments: any[] = []

      if (includeFile && selectedFile && !selectedFile.isDirectory) {
        const fileData = await window.api.fs.readFile(selectedFile.path)
        attachments.push({
          filename: selectedFile.name,
          content: Buffer.from(fileData).toString('base64'),
          contentType: getMimeType(selectedFile.extension)
        })
      }

      if (includePreflight && preflight) {
        const reportText = formatPreflightText(preflight)
        attachments.push({
          filename: `preflight_${preflight.fileName}.txt`,
          content: Buffer.from(reportText).toString('base64'),
          contentType: 'text/plain'
        })
      }

      await window.api.presscal.sendEmail({
        to, subject, body,
        attachments: attachments.length > 0 ? attachments : undefined
      })

      setSent(true)
      setTimeout(() => setSent(false), 3000)
    } catch (e: any) {
      setError(e.message || 'Failed to send email')
    } finally {
      setSending(false)
    }
  }, [to, subject, body, selectedFile, includeFile, includePreflight, preflight])

  const inputCls = "w-full px-3 py-2.5 bg-bg-primary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"

  return (
    <div className="p-4 space-y-4">
      {selectedFile && !selectedFile.isDirectory && (
        <div className="flex items-center gap-3 p-3 bg-bg-primary rounded-lg">
          <Paperclip size={16} className="text-accent flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-text-primary truncate">{selectedFile.name}</div>
            <div className="text-sm text-text-muted">{formatFileSize(selectedFile.size)}</div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer flex-shrink-0">
            <input type="checkbox" checked={includeFile} onChange={e => setIncludeFile(e.target.checked)} className="w-4 h-4 accent-accent" />
            <span className="text-sm text-text-muted">Attach</span>
          </label>
        </div>
      )}

      {preflight && (
        <label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-bg-hover rounded-lg">
          <input type="checkbox" checked={includePreflight} onChange={e => setIncludePreflight(e.target.checked)} className="w-4 h-4 accent-accent" />
          <FileText size={14} className="text-text-muted" />
          <span className="text-sm text-text-secondary">Include preflight report ({preflight.overallStatus})</span>
        </label>
      )}

      <div className="space-y-3">
        <input type="email" value={to} onChange={e => setTo(e.target.value)} placeholder="To: email@example.com" className={inputCls} />
        <input type="text" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" className={inputCls} />
        <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Message..." rows={5} className={`${inputCls} resize-none`} />
      </div>

      {error && <div className="text-sm text-error px-1">{error}</div>}

      <button
        className="w-full flex items-center justify-center gap-2 py-3 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
        onClick={handleSend}
        disabled={sending || !to || !subject}
      >
        {sending ? <><Loader2 size={16} className="animate-spin" /> Sending...</> : sent ? <><CheckCircle size={16} /> Sent!</> : <><Send size={16} /> Send via PressCal</>}
      </button>
    </div>
  )
}

function getMimeType(ext: string): string {
  const types: Record<string, string> = {
    '.pdf': 'application/pdf', '.ai': 'application/postscript', '.psd': 'image/vnd.adobe.photoshop',
    '.eps': 'application/postscript', '.tif': 'image/tiff', '.tiff': 'image/tiff',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml'
  }
  return types[ext] || 'application/octet-stream'
}

function formatPreflightText(report: any): string {
  let text = `PREFLIGHT REPORT\n${'='.repeat(40)}\nFile: ${report.fileName}\nStatus: ${report.overallStatus.toUpperCase()}\n${'='.repeat(40)}\n\n`
  for (const check of report.checks) {
    const icon = check.severity === 'pass' ? '[OK]' : check.severity === 'warning' ? '[!!]' : check.severity === 'error' ? '[XX]' : '[--]'
    text += `${icon} ${check.label}: ${check.value}\n`
    if (check.detail) text += `    ${check.detail}\n`
  }
  return text
}
