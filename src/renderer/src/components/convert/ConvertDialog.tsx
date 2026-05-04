import { useState, useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '@/stores/app-store'
import {
  RefreshCw, ArrowRight, Loader2, CheckCircle, XCircle,
  FileImage, Palette, Maximize, Layers, X, FolderOpen, Scissors
} from 'lucide-react'
import { formatFileSize } from '@/lib/file-types'

type OutputFormat = 'tiff' | 'png' | 'jpg' | 'pdf'

interface ConvertOptions {
  format: OutputFormat
  colorSpace: 'cmyk' | 'srgb' | 'keep'
  dpi: number
  quality: number
  flatten: boolean
  useTrimBox: boolean
  maxWidth?: number
  maxHeight?: number
}

interface ConvertResult {
  success: boolean
  inputPath: string
  outputPath: string
  inputSize: number
  outputSize: number
  error?: string
}

export function ConvertDialog({ onClose }: { onClose: () => void }) {
  const { selectedFile } = useAppStore()
  const [options, setOptions] = useState<ConvertOptions>({
    format: 'tiff',
    colorSpace: 'cmyk',
    dpi: 300,
    quality: 95,
    flatten: true,
    useTrimBox: true
  })
  const [converting, setConverting] = useState(false)
  const [result, setResult] = useState<ConvertResult | null>(null)
  const [progress, setProgress] = useState<any>(null)
  const [hasGs, setHasGs] = useState(false)
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    cleanupRef.current = window.api.batch.onProgress(setProgress)
    window.api.convert.hasGhostscript().then(setHasGs)
    return () => cleanupRef.current?.()
  }, [])

  const isPdfInput = selectedFile && ['.pdf', '.ai', '.eps'].includes(
    (selectedFile.extension || '').toLowerCase()
  )

  const outputFormats: OutputFormat[] = isPdfInput
    ? (hasGs ? ['tiff', 'png', 'jpg', 'pdf'] : [])
    : ['tiff', 'png', 'jpg']

  const handleConvert = useCallback(async () => {
    if (!selectedFile) return
    setConverting(true)
    setResult(null)
    try {
      const res = await window.api.convert.file(selectedFile.path, options)
      setResult(res)
    } catch (err: any) {
      setResult({
        success: false, inputPath: selectedFile.path, outputPath: '',
        inputSize: selectedFile.size, outputSize: 0, error: err.message
      })
    } finally {
      setConverting(false)
    }
  }, [selectedFile, options])

  if (!selectedFile || selectedFile.isDirectory) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--th-text-muted)', fontSize: 13 }}>
        Select a file to convert
      </div>
    )
  }

  if (isPdfInput && !hasGs) {
    return (
      <div className="flex flex-col">
        <PanelHeader onClose={onClose} />
        <div style={{ padding: 24 }}>
          <div style={{ fontSize: 13, color: 'var(--th-text-muted)', lineHeight: 1.6 }}>
            PDF conversion requires Ghostscript, which was not found on your system.
            <br /><br />
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); window.open('https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/gs10050/gs10050w64.exe') }}
              style={{ color: 'var(--th-accent)', textDecoration: 'underline', cursor: 'pointer' }}
            >
              Download Ghostscript (64-bit)
            </a>
            <br />
            <span style={{ fontSize: 11, color: 'var(--th-text-muted)' }}>
              After installation, restart PressKit.
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col overflow-y-auto" style={{ background: 'var(--th-bg-secondary)', maxHeight: '80vh' }}>
      {/* Header */}
      <PanelHeader onClose={onClose} />

      {/* Source file */}
      <Section>
        <SectionLabel>Source</SectionLabel>
        <div className="flex items-center" style={{ gap: 10, marginTop: 6 }}>
          <FileImage size={18} style={{ color: 'var(--th-text-muted)', flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: 'var(--th-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selectedFile.name}
          </span>
          <span style={{ fontSize: 12, color: 'var(--th-text-muted)', flexShrink: 0 }}>
            {formatFileSize(selectedFile.size)}
          </span>
        </div>
      </Section>

      {/* Output Format */}
      <Section>
        <SectionLabel><FileImage size={14} style={{ marginRight: 10 }} />Output Format</SectionLabel>
        <div className="flex items-center" style={{ gap: 6, marginTop: 8 }}>
          {outputFormats.map(fmt => (
            <OptionButton
              key={fmt}
              active={options.format === fmt}
              onClick={() => setOptions(o => ({ ...o, format: fmt }))}
            >
              {fmt === 'pdf' ? 'PDF (flatten)' : fmt.toUpperCase()}
            </OptionButton>
          ))}
        </div>
      </Section>

      {/* Color Space */}
      <Section>
        <SectionLabel><Palette size={14} style={{ marginRight: 10 }} />Color Space</SectionLabel>
        <div className="flex items-center" style={{ gap: 6, marginTop: 8 }}>
          {([
            { value: 'cmyk', label: 'CMYK' },
            { value: 'srgb', label: 'sRGB' },
            { value: 'keep', label: 'Keep' }
          ] as const).map(cs => (
            <OptionButton
              key={cs.value}
              active={options.colorSpace === cs.value}
              onClick={() => setOptions(o => ({ ...o, colorSpace: cs.value }))}
            >
              {cs.label}
            </OptionButton>
          ))}
        </div>
        {options.colorSpace === 'cmyk' && (options.format === 'jpg' || options.format === 'png') && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#f59e0b', lineHeight: 1.5 }}>
            ⚠ Το CMYK δεν υποστηρίζεται σε {options.format.toUpperCase()}. Χρησιμοποίησε TIFF ή PDF για CMYK output.
          </div>
        )}
      </Section>

      {/* Resolution */}
      <Section>
        <SectionLabel><Maximize size={14} style={{ marginRight: 10 }} />Resolution (DPI)</SectionLabel>
        <div className="flex items-center" style={{ gap: 6, marginTop: 8 }}>
          {[150, 300, 600].map(dpi => (
            <OptionButton
              key={dpi}
              active={options.dpi === dpi}
              onClick={() => setOptions(o => ({ ...o, dpi }))}
            >
              {dpi}
            </OptionButton>
          ))}
          <input
            type="number"
            value={options.dpi}
            onChange={e => setOptions(o => ({ ...o, dpi: Number(e.target.value) || 300 }))}
            style={{
              width: 72, padding: '8px 10px', fontSize: 13, textAlign: 'center',
              background: 'var(--th-bg-primary)', border: '1px solid var(--th-border)',
              borderRadius: 8, color: 'var(--th-text-primary)', outline: 'none',
            }}
          />
        </div>
      </Section>

      {/* Quality (JPEG only) */}
      {options.format === 'jpg' && (
        <Section>
          <SectionLabel>Quality: {options.quality}%</SectionLabel>
          <input
            type="range" min={50} max={100} value={options.quality}
            onChange={e => setOptions(o => ({ ...o, quality: Number(e.target.value) }))}
            style={{ width: '100%', marginTop: 8, accentColor: '#6ec8c8' }}
          />
        </Section>
      )}

      {/* Resize */}
      <Section>
        <SectionLabel><Maximize size={14} style={{ marginRight: 10 }} />Μέγιστες διαστάσεις (mm)</SectionLabel>
        <div className="flex items-center" style={{ gap: 8, marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
            <span style={{ fontSize: 12, color: 'var(--th-text-muted)', width: 16 }}>W</span>
            <input
              type="number"
              placeholder="Auto"
              value={options.maxWidth ? Math.round(options.maxWidth / (options.dpi / 25.4)) : ''}
              onChange={e => {
                const mm = Number(e.target.value)
                setOptions(o => ({ ...o, maxWidth: mm ? Math.round(mm * (o.dpi / 25.4)) : undefined }))
              }}
              style={{
                flex: 1, padding: '8px 10px', fontSize: 13, textAlign: 'center',
                background: 'var(--th-bg-primary)', border: '1px solid var(--th-border)',
                borderRadius: 8, color: 'var(--th-text-primary)', outline: 'none',
                minWidth: 0,
              }}
            />
          </div>
          <X size={14} style={{ color: 'var(--th-text-muted)', flexShrink: 0 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
            <span style={{ fontSize: 12, color: 'var(--th-text-muted)', width: 16 }}>H</span>
            <input
              type="number"
              placeholder="Auto"
              value={options.maxHeight ? Math.round(options.maxHeight / (options.dpi / 25.4)) : ''}
              onChange={e => {
                const mm = Number(e.target.value)
                setOptions(o => ({ ...o, maxHeight: mm ? Math.round(mm * (o.dpi / 25.4)) : undefined }))
              }}
              style={{
                flex: 1, padding: '8px 10px', fontSize: 13, textAlign: 'center',
                background: 'var(--th-bg-primary)', border: '1px solid var(--th-border)',
                borderRadius: 8, color: 'var(--th-text-primary)', outline: 'none',
                minWidth: 0,
              }}
            />
          </div>
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--th-text-muted)' }}>
          Σμικρύνει ώστε να χωράει στις διαστάσεις (δεν μεγαλώνει). Κενό = χωρίς αλλαγή.
        </div>
      </Section>

      {/* Flatten transparency (non-PDF) */}
      {options.format !== 'pdf' && !isPdfInput && (
        <Section>
          <label className="flex items-center cursor-pointer" style={{
            gap: 10, padding: '8px 12px', borderRadius: 8,
            background: options.flatten ? 'rgba(110,200,200,0.06)' : 'transparent',
          }}>
            <input
              type="checkbox" checked={options.flatten}
              onChange={e => setOptions(o => ({ ...o, flatten: e.target.checked }))}
              style={{ width: 18, height: 18, accentColor: '#6ec8c8', flexShrink: 0 }}
            />
            <Layers size={16} style={{ color: 'var(--th-text-muted)', flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: 'var(--th-text-secondary)' }}>Flatten transparency</span>
          </label>
        </Section>
      )}

      {/* Use TrimBox (PDF/AI/EPS only) */}
      {isPdfInput && (
        <Section>
          <label className="flex items-center cursor-pointer" style={{
            gap: 10, padding: '8px 12px', borderRadius: 8,
            background: options.useTrimBox ? 'rgba(110,200,200,0.06)' : 'transparent',
          }}>
            <input
              type="checkbox" checked={options.useTrimBox}
              onChange={e => setOptions(o => ({ ...o, useTrimBox: e.target.checked }))}
              style={{ width: 18, height: 18, accentColor: '#6ec8c8', flexShrink: 0 }}
            />
            <Scissors size={16} style={{ color: 'var(--th-text-muted)', flexShrink: 0 }} />
            <div>
              <span style={{ fontSize: 13, color: 'var(--th-text-secondary)' }}>Crop στο TrimBox</span>
              <div style={{ fontSize: 11, color: 'var(--th-text-muted)', marginTop: 2 }}>
                Αφαιρεί bleed και cropmarks
              </div>
            </div>
          </label>
        </Section>
      )}

      {/* Info for PDF flatten */}
      {isPdfInput && options.format === 'pdf' && (
        <div style={{ padding: '8px 24px', fontSize: 12, color: 'var(--th-text-muted)', fontStyle: 'italic' }}>
          Flattens transparency, embeds fonts, converts to PDF 1.4
        </div>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Convert button / Result */}
      <div style={{ padding: '20px 24px' }}>
        {result ? (
          <div style={{
            padding: 16, borderRadius: 10,
            background: result.success ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
            border: `1px solid ${result.success ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
          }}>
            <div className="flex items-center" style={{ gap: 8, marginBottom: 6 }}>
              {result.success
                ? <CheckCircle size={18} style={{ color: '#22c55e' }} />
                : <XCircle size={18} style={{ color: '#ef4444' }} />
              }
              <span style={{ fontSize: 13, fontWeight: 600, color: result.success ? '#22c55e' : '#ef4444' }}>
                {result.success ? 'Ολοκληρώθηκε!' : 'Αποτυχία μετατροπής'}
              </span>
            </div>

            {result.success ? (
              <div style={{ marginLeft: 26, fontSize: 12, color: 'var(--th-text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div>{result.outputPath.split(/[/\\]/).pop()}</div>
                <div>{formatFileSize(result.inputSize)} → {formatFileSize(result.outputSize)}</div>
                <div className="flex items-center" style={{ gap: 12, marginTop: 8 }}>
                  <button
                    onClick={() => window.api.shell.showInFolder(result.outputPath)}
                    className="flex items-center"
                    style={{ gap: 4, color: '#6ec8c8', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    <FolderOpen size={13} /> Άνοιγμα φακέλου
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ marginLeft: 26, fontSize: 12, color: '#ef4444' }}>{result.error}</div>
            )}

            {/* Action buttons after result */}
            <div className="flex items-center" style={{ gap: 8, marginTop: 14 }}>
              <button
                onClick={() => setResult(null)}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: 6, padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                  border: '1px solid var(--th-border)', background: 'var(--th-bg-primary)',
                  color: 'var(--th-text-secondary)', cursor: 'pointer',
                }}
              >
                <RefreshCw size={14} /> Νέα μετατροπή
              </button>
              <button
                onClick={onClose}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: 6, padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                  border: 'none', background: '#6ec8c8', color: '#fff', cursor: 'pointer',
                }}
              >
                OK
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={handleConvert}
            disabled={converting}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 8, padding: '12px 20px', borderRadius: 10, border: 'none',
              background: '#6ec8c8', color: '#fff', fontSize: 14, fontWeight: 600,
              cursor: converting ? 'default' : 'pointer',
              opacity: converting ? 0.6 : 1,
            }}
          >
            {converting ? (
              <><Loader2 size={16} className="animate-spin" /> Μετατροπή...</>
            ) : (
              <><ArrowRight size={16} /> Convert to {options.format === 'pdf' ? 'Flat PDF' : options.format.toUpperCase()}</>
            )}
          </button>
        )}
      </div>
    </div>
  )
}

function PanelHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center" style={{
      padding: '14px 24px', borderBottom: '1px solid var(--th-border)', gap: 10,
    }}>
      <RefreshCw size={18} style={{ color: '#6ec8c8' }} />
      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--th-text-primary)', flex: 1 }}>Convert File</span>
      <button
        onClick={onClose}
        title="Κλείσιμο"
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          padding: 4, borderRadius: 6, color: 'var(--th-text-muted)',
          display: 'flex', alignItems: 'center',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--th-text-primary)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--th-text-muted)' }}
      >
        <X size={18} />
      </button>
    </div>
  )
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--th-border)' }}>
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center" style={{ fontSize: 13, fontWeight: 500, color: 'var(--th-text-muted)' }}>
      {children}
    </div>
  )
}

function OptionButton({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
        border: 'none', cursor: 'pointer',
        background: active ? 'rgba(110,200,200,0.12)' : 'var(--th-bg-primary)',
        color: active ? '#6ec8c8' : 'var(--th-text-secondary)',
      }}
    >
      {children}
    </button>
  )
}
