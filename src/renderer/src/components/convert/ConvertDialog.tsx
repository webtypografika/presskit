import { useState, useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '@/stores/app-store'
import {
  RefreshCw, ArrowRight, Loader2, CheckCircle, XCircle,
  FileImage, Palette, Maximize, Layers
} from 'lucide-react'
import { formatFileSize } from '@/lib/file-types'

interface ConvertOptions {
  format: 'tiff' | 'png' | 'jpg'
  colorSpace: 'cmyk' | 'srgb' | 'keep'
  dpi: number
  quality: number
  flatten: boolean
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
    flatten: true
  })
  const [converting, setConverting] = useState(false)
  const [result, setResult] = useState<ConvertResult | null>(null)
  const [progress, setProgress] = useState<any>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    cleanupRef.current = window.api.batch.onProgress(setProgress)
    return () => cleanupRef.current?.()
  }, [])

  const handleConvert = useCallback(async () => {
    if (!selectedFile) return
    setConverting(true)
    setResult(null)

    try {
      const res = await window.api.convert.file(selectedFile.path, options)
      setResult(res)
    } catch (err: any) {
      setResult({
        success: false,
        inputPath: selectedFile.path,
        outputPath: '',
        inputSize: selectedFile.size,
        outputSize: 0,
        error: err.message
      })
    } finally {
      setConverting(false)
    }
  }, [selectedFile, options])

  if (!selectedFile || selectedFile.isDirectory) {
    return (
      <div className="p-4 text-center text-text-muted text-xs">
        Select a file to convert
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-bg-secondary">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border" style={{ padding: '14px 20px' }}>
        <div className="flex items-center gap-2">
          <RefreshCw size={16} className="text-accent" />
          <span className="text-sm font-medium">Convert File</span>
        </div>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary text-xs">Close</button>
      </div>

      {/* Source file */}
      <div className="border-b border-border" style={{ padding: '14px 20px' }}>
        <div className="text-sm text-text-muted mb-1">Source</div>
        <div className="flex items-center gap-2">
          <FileImage size={14} className="text-text-secondary" />
          <span className="text-xs text-text-primary truncate">{selectedFile.name}</span>
          <span className="text-xs text-text-muted">({formatFileSize(selectedFile.size)})</span>
        </div>
      </div>

      {/* Options */}
      <div className="border-b border-border" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Format */}
        <div>
          <label className="text-sm text-text-muted block mb-1">
            <FileImage size={11} className="inline mr-1" />Output Format
          </label>
          <div className="flex items-center gap-1">
            {(['tiff', 'png', 'jpg'] as const).map(fmt => (
              <button
                key={fmt}
                className={`px-3 py-1 rounded text-xs ${
                  options.format === fmt
                    ? 'bg-accent/10 text-accent'
                    : 'bg-bg-primary text-text-secondary hover:text-text-primary'
                }`}
                onClick={() => setOptions(o => ({ ...o, format: fmt }))}
              >
                {fmt.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Color Space */}
        <div>
          <label className="text-sm text-text-muted block mb-1">
            <Palette size={11} className="inline mr-1" />Color Space
          </label>
          <div className="flex items-center gap-1">
            {([
              { value: 'cmyk', label: 'CMYK' },
              { value: 'srgb', label: 'sRGB' },
              { value: 'keep', label: 'Keep' }
            ] as const).map(cs => (
              <button
                key={cs.value}
                className={`px-3 py-1 rounded text-xs ${
                  options.colorSpace === cs.value
                    ? 'bg-accent/10 text-accent'
                    : 'bg-bg-primary text-text-secondary hover:text-text-primary'
                }`}
                onClick={() => setOptions(o => ({ ...o, colorSpace: cs.value }))}
              >
                {cs.label}
              </button>
            ))}
          </div>
        </div>

        {/* DPI */}
        <div>
          <label className="text-sm text-text-muted block mb-1">
            <Maximize size={11} className="inline mr-1" />Resolution (DPI)
          </label>
          <div className="flex items-center gap-1">
            {[150, 300, 600].map(dpi => (
              <button
                key={dpi}
                className={`px-3 py-1 rounded text-xs ${
                  options.dpi === dpi
                    ? 'bg-accent/10 text-accent'
                    : 'bg-bg-primary text-text-secondary hover:text-text-primary'
                }`}
                onClick={() => setOptions(o => ({ ...o, dpi }))}
              >
                {dpi}
              </button>
            ))}
            <input
              type="number"
              value={options.dpi}
              onChange={e => setOptions(o => ({ ...o, dpi: Number(e.target.value) || 300 }))}
              className="w-16 px-2 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary text-center"
            />
          </div>
        </div>

        {/* Quality (JPEG only) */}
        {options.format === 'jpg' && (
          <div>
            <label className="text-sm text-text-muted block mb-1">Quality: {options.quality}%</label>
            <input
              type="range"
              min={50}
              max={100}
              value={options.quality}
              onChange={e => setOptions(o => ({ ...o, quality: Number(e.target.value) }))}
              className="w-full accent-accent"
            />
          </div>
        )}

        {/* Flatten transparency */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={options.flatten}
            onChange={e => setOptions(o => ({ ...o, flatten: e.target.checked }))}
            className="w-3 h-3 accent-accent"
          />
          <Layers size={11} className="text-text-muted" />
          <span className="text-sm text-text-secondary">Flatten transparency (white background)</span>
        </label>
      </div>

      {/* Convert button */}
      <div style={{ padding: '16px 20px' }}>
        <button
          onClick={handleConvert}
          disabled={converting}
          className="w-full flex items-center justify-center gap-2 py-2 bg-accent text-white rounded text-xs font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
        >
          {converting ? (
            <><Loader2 size={14} className="animate-spin" /> Converting...</>
          ) : (
            <><ArrowRight size={14} /> Convert to {options.format.toUpperCase()}</>
          )}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className={`rounded ${result.success ? 'bg-success/10' : 'bg-error/10'}`} style={{ margin: '0 20px 16px', padding: 16 }}>
          <div className="flex items-center gap-2 mb-1">
            {result.success ? (
              <CheckCircle size={14} className="text-success" />
            ) : (
              <XCircle size={14} className="text-error" />
            )}
            <span className={`text-xs font-medium ${result.success ? 'text-success' : 'text-error'}`}>
              {result.success ? 'Converted successfully' : 'Conversion failed'}
            </span>
          </div>

          {result.success ? (
            <div className="text-sm text-text-secondary space-y-0.5 ml-5">
              <div>Output: {result.outputPath.split(/[/\\]/).pop()}</div>
              <div>Size: {formatFileSize(result.inputSize)} → {formatFileSize(result.outputSize)}</div>
              <button
                className="text-accent hover:underline mt-1"
                onClick={() => window.api.shell.showInFolder(result.outputPath)}
              >
                Show in folder
              </button>
            </div>
          ) : (
            <div className="text-sm text-error ml-5">{result.error}</div>
          )}
        </div>
      )}
    </div>
  )
}
