import { useState, useEffect } from 'react'
import { useAppStore } from '@/stores/app-store'
import { Palette, Loader2, Droplets } from 'lucide-react'
import { isImageType } from '@/lib/file-types'

interface RgbColor {
  r: number
  g: number
  b: number
  hex: string
  percentage: number
}

interface ChannelHistogram {
  cyan?: number
  magenta?: number
  yellow?: number
  black?: number
  totalInkCoverage?: number
}

export function ColorPalette() {
  const { selectedFile } = useAppStore()
  const [palette, setPalette] = useState<RgbColor[]>([])
  const [histogram, setHistogram] = useState<ChannelHistogram | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!selectedFile || selectedFile.isDirectory || !isImageType(selectedFile.type)) {
      setPalette([])
      setHistogram(null)
      return
    }

    setLoading(true)
    window.api.color.extractPalette(selectedFile.path, 8)
      .then(result => {
        setPalette(result.dominant)
        setHistogram(result.histogram)
      })
      .catch(() => {
        setPalette([])
        setHistogram(null)
      })
      .finally(() => setLoading(false))
  }, [selectedFile])

  if (!selectedFile || selectedFile.isDirectory || !isImageType(selectedFile.type)) {
    return null
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 size={16} className="animate-spin text-text-muted" />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden', width: '100%' }}>
      {/* Color palette */}
      {palette.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2 text-sm font-medium text-text-muted uppercase tracking-wider">
            <Palette size={12} />
            Dominant Colors
          </div>

          {/* Color bar */}
          <div className="h-6 rounded overflow-hidden flex">
            {palette.map((color, i) => (
              <div
                key={i}
                style={{
                  backgroundColor: color.hex,
                  width: `${color.percentage}%`,
                  minWidth: 4
                }}
                title={`${color.hex} (${color.percentage}%)`}
              />
            ))}
          </div>

          {/* Color swatches */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))', gap: 6, marginTop: 8 }}>
            {palette.map((color, i) => (
              <div
                key={i}
                className="flex flex-col items-center cursor-pointer group"
                style={{ overflow: 'hidden' }}
                onClick={() => navigator.clipboard.writeText(color.hex)}
                title="Click to copy"
              >
                <div
                  className="w-full h-6 rounded border border-border group-hover:ring-1 ring-accent"
                  style={{ backgroundColor: color.hex }}
                />
                <span className="text-xs text-text-muted mt-0.5 font-mono" style={{ fontSize: 10 }}>
                  {color.hex}
                </span>
                <span className="text-xs text-text-muted" style={{ fontSize: 10 }}>
                  {color.percentage}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ink coverage */}
      {histogram && (
        <div>
          <div className="flex items-center gap-1.5 mb-2 text-sm font-medium text-text-muted uppercase tracking-wider">
            <Droplets size={12} />
            Ink Coverage (CMYK)
          </div>

          <div className="space-y-1.5">
            <InkBar label="C" value={histogram.cyan || 0} color="#00bcd4" />
            <InkBar label="M" value={histogram.magenta || 0} color="#e91e63" />
            <InkBar label="Y" value={histogram.yellow || 0} color="#ffc107" />
            <InkBar label="K" value={histogram.black || 0} color="#424242" />
          </div>

          {/* TAC */}
          {histogram.totalInkCoverage !== undefined && (
            <div className={`mt-2 px-2 py-1 rounded text-sm ${
              histogram.totalInkCoverage > 300
                ? 'bg-error/10 text-error'
                : histogram.totalInkCoverage > 280
                  ? 'bg-warning/10 text-warning'
                  : 'bg-success/10 text-success'
            }`}>
              TAC: {histogram.totalInkCoverage}%
              {histogram.totalInkCoverage > 300 && ' — Exceeds 300% limit!'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function InkBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-mono w-3 text-text-muted">{label}</span>
      <div className="flex-1 h-3 bg-bg-primary rounded overflow-hidden">
        <div
          className="h-full rounded transition-all"
          style={{ width: `${Math.min(100, value)}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs text-text-muted w-8 text-right">{value}%</span>
    </div>
  )
}
