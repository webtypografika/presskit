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
        <PanelHeader onClose={onClose} selectedFile={selectedFile} />
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
    <div className="flex flex-col" style={{ background: 'var(--th-bg-secondary)' }}>
      {/* Header with source file info */}
      <PanelHeader onClose={onClose} selectedFile={selectedFile} />

      {/* Scrollable options area */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '12px 20px' }}>

        {/* Row 1: Format + Color Space */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <SectionLabel><FileImage size={13} style={{ marginRight: 6 }} />Format</SectionLabel>
            <div className="flex items-center" style={{ gap: 4, marginTop: 6 }}>
              {outputFormats.map(fmt => (
                <OptionButton
                  key={fmt}
                  active={options.format === fmt}
                  onClick={() => setOptions(o => {
                    const needsSwitch = (fmt === 'jpg' || fmt === 'png') && o.colorSpace === 'cmyk'
                    return { ...o, format: fmt, colorSpace: needsSwitch ? 'srgb' : o.colorSpace }
                  })}
                >
                  {fmt === 'pdf' ? 'PDF' : fmt.toUpperCase()}
                </OptionButton>
              ))}
            </div>
          </div>
          <div>
            <SectionLabel><Palette size={13} style={{ marginRight: 6 }} />Color</SectionLabel>
            <div className="flex items-center" style={{ gap: 4, marginTop: 6 }}>
              {([
                { value: 'cmyk', label: 'CMYK' },
                { value: 'srgb', label: 'sRGB' },
                { value: 'keep', label: 'Keep' }
              ] as const).map(cs => {
                const cmykDisabled = cs.value === 'cmyk' && (options.format === 'jpg' || options.format === 'png')
                return (
                  <OptionButton
                    key={cs.value}
                    active={options.colorSpace === cs.value}
                    disabled={cmykDisabled}
                    onClick={() => !cmykDisabled && setOptions(o => ({ ...o, colorSpace: cs.value }))}
                  >
                    {cs.label}
                  </OptionButton>
                )
              })}
            </div>
          </div>
        </div>

        <div style={{ borderBottom: '1px solid var(--th-border)', margin: '12px 0' }} />

        {/* Row 2: DPI + Quality */}
        <div style={{ display: 'grid', gridTemplateColumns: options.format === 'jpg' ? '1fr 1fr' : '1fr', gap: 16 }}>
          <div>
            <SectionLabel><Maximize size={13} style={{ marginRight: 6 }} />DPI</SectionLabel>
            <div className="flex items-center" style={{ gap: 4, marginTop: 6 }}>
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
                  width: 90, padding: '6px 8px', fontSize: 12, textAlign: 'center',
                  background: 'var(--th-bg-primary)', border: '1px solid var(--th-border)',
                  borderRadius: 6, color: 'var(--th-text-primary)', outline: 'none',
                }}
              />
            </div>
          </div>
          {options.format === 'jpg' && (
            <div>
              <SectionLabel>Quality: {options.quality}%</SectionLabel>
              <input
                type="range" min={50} max={100} value={options.quality}
                onChange={e => setOptions(o => ({ ...o, quality: Number(e.target.value) }))}
                style={{ width: '100%', marginTop: 10, accentColor: '#6ec8c8' }}
              />
            </div>
          )}
        </div>

        <div style={{ borderBottom: '1px solid var(--th-border)', margin: '12px 0' }} />

        {/* Row 3: Resize */}
        <div>
          <SectionLabel><Maximize size={13} style={{ marginRight: 6 }} />Διαστάσεις (mm)</SectionLabel>
          <div className="flex items-center" style={{ gap: 6, marginTop: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--th-text-muted)' }}>W</span>
            <input
              type="number"
              placeholder="Auto"
              value={options.maxWidth ? Math.round(options.maxWidth / (options.dpi / 25.4)) : ''}
              onChange={e => {
                const mm = Number(e.target.value)
                setOptions(o => ({ ...o, maxWidth: mm ? Math.round(mm * (o.dpi / 25.4)) : undefined }))
              }}
              style={{
                flex: 1, padding: '6px 8px', fontSize: 13, textAlign: 'center',
                background: 'var(--th-bg-primary)', border: '1px solid var(--th-border)',
                borderRadius: 6, color: 'var(--th-text-primary)', outline: 'none',
                minWidth: 0,
              }}
            />
            <X size={12} style={{ color: 'var(--th-text-muted)', flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: 'var(--th-text-muted)' }}>H</span>
            <input
              type="number"
              placeholder="Auto"
              value={options.maxHeight ? Math.round(options.maxHeight / (options.dpi / 25.4)) : ''}
              onChange={e => {
                const mm = Number(e.target.value)
                setOptions(o => ({ ...o, maxHeight: mm ? Math.round(mm * (o.dpi / 25.4)) : undefined }))
              }}
              style={{
                flex: 1, padding: '6px 8px', fontSize: 13, textAlign: 'center',
                background: 'var(--th-bg-primary)', border: '1px solid var(--th-border)',
                borderRadius: 6, color: 'var(--th-text-primary)', outline: 'none',
                minWidth: 0,
              }}
            />
          </div>
          <div style={{ marginTop: 4, fontSize: 10, color: 'var(--th-text-muted)', opacity: 0.7 }}>
            Αλλάζει μέγεθος αναλογικά. Κενό = χωρίς αλλαγή.
          </div>
        </div>

        {/* Checkboxes row */}
        {((!isPdfInput && options.format !== 'pdf') || isPdfInput) && (
          <>
            <div style={{ borderBottom: '1px solid var(--th-border)', margin: '12px 0' }} />
            <div className="flex items-center" style={{ gap: 16 }}>
              {/* Flatten transparency (non-PDF input) */}
              {options.format !== 'pdf' && !isPdfInput && (
                <label className="flex items-center cursor-pointer" style={{ gap: 6 }}>
                  <input
                    type="checkbox" checked={options.flatten}
                    onChange={e => setOptions(o => ({ ...o, flatten: e.target.checked }))}
                    style={{ width: 16, height: 16, accentColor: '#6ec8c8', flexShrink: 0 }}
                  />
                  <Layers size={14} style={{ color: 'var(--th-text-muted)', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--th-text-secondary)' }}>Flatten</span>
                </label>
              )}

              {/* TrimBox (PDF/AI/EPS only) */}
              {isPdfInput && (
                <label className="flex items-center cursor-pointer" style={{ gap: 6 }}>
                  <input
                    type="checkbox" checked={options.useTrimBox}
                    onChange={e => setOptions(o => ({ ...o, useTrimBox: e.target.checked }))}
                    style={{ width: 16, height: 16, accentColor: '#6ec8c8', flexShrink: 0 }}
                  />
                  <Scissors size={14} style={{ color: 'var(--th-text-muted)', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--th-text-secondary)' }}>Crop TrimBox</span>
                </label>
              )}

              {/* PDF flatten info */}
              {isPdfInput && options.format === 'pdf' && (
                <span style={{ fontSize: 11, color: 'var(--th-text-muted)', fontStyle: 'italic' }}>
                  Flatten + PDF 1.4
                </span>
              )}
            </div>
          </>
        )}
      </div>{/* end scrollable area */}

      {/* Convert button / Result — always visible */}
      <div style={{ padding: '14px 20px', borderTop: '1px solid var(--th-border)', flexShrink: 0 }}>
        {result ? (
          <div style={{
            padding: 12, borderRadius: 8,
            background: result.success ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
            border: `1px solid ${result.success ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
          }}>
            <div className="flex items-center" style={{ gap: 8 }}>
              {result.success
                ? <CheckCircle size={16} style={{ color: '#22c55e' }} />
                : <XCircle size={16} style={{ color: '#ef4444' }} />
              }
              <span style={{ fontSize: 13, fontWeight: 600, color: result.success ? '#22c55e' : '#ef4444', flex: 1 }}>
                {result.success ? 'OK' : 'Αποτυχία'}
              </span>
              {result.success && (
                <span style={{ fontSize: 12, color: 'var(--th-text-muted)' }}>
                  {formatFileSize(result.inputSize)} → {formatFileSize(result.outputSize)}
                </span>
              )}
            </div>

            {result.success ? (
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--th-text-secondary)', display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {result.outputPath.split(/[/\\]/).pop()}
                </span>
                <button
                  onClick={() => window.api.shell.showInFolder(result.outputPath)}
                  className="flex items-center"
                  style={{ gap: 4, color: '#6ec8c8', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0 }}
                >
                  <FolderOpen size={13} /> Φάκελος
                </button>
              </div>
            ) : (
              <div style={{ marginTop: 4, fontSize: 12, color: '#ef4444' }}>{result.error}</div>
            )}

            <div className="flex items-center" style={{ gap: 8, marginTop: 10 }}>
              <button
                onClick={() => setResult(null)}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: 6, padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                  border: '1px solid var(--th-border)', background: 'var(--th-bg-primary)',
                  color: 'var(--th-text-secondary)', cursor: 'pointer',
                }}
              >
                <RefreshCw size={14} /> Νέα
              </button>
              <button
                onClick={onClose}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: 6, padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500,
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
              gap: 8, padding: '10px 20px', borderRadius: 8, border: 'none',
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

function PanelHeader({ onClose, selectedFile }: { onClose: () => void; selectedFile: { name: string; size: number } }) {
  return (
    <div className="flex items-center" style={{
      padding: '10px 20px', borderBottom: '1px solid var(--th-border)', gap: 8,
    }}>
      <RefreshCw size={16} style={{ color: '#6ec8c8', flexShrink: 0 }} />
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--th-text-primary)' }}>Convert</span>
      <span style={{ fontSize: 12, color: 'var(--th-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
        — {selectedFile.name} ({formatFileSize(selectedFile.size)})
      </span>
      <button
        onClick={onClose}
        title="Κλείσιμο"
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          padding: 4, borderRadius: 6, color: 'var(--th-text-muted)',
          display: 'flex', alignItems: 'center', flexShrink: 0,
        }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--th-text-primary)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--th-text-muted)' }}
      >
        <X size={16} />
      </button>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center" style={{ fontSize: 12, fontWeight: 500, color: 'var(--th-text-muted)' }}>
      {children}
    </div>
  )
}

function OptionButton({ active, disabled, onClick, children }: {
  active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.35 : 1,
        background: active ? 'rgba(110,200,200,0.12)' : 'var(--th-bg-primary)',
        color: active ? '#6ec8c8' : 'var(--th-text-secondary)',
      }}
    >
      {children}
    </button>
  )
}
