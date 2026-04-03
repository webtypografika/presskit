import { useState, useEffect } from 'react'
import { useAppStore } from '@/stores/app-store'
import { Loader2, Droplet, AlertTriangle, Copy, Check } from 'lucide-react'

interface SpotColorInfo {
  name: string
  alternateSpace: string
  tintTransform?: string
  pantoneMatch?: {
    name: string
    c: number; m: number; y: number; k: number
    r: number; g: number; b: number
    hex: string
  } | null
}

export function SpotColorPanel() {
  const { selectedFile } = useAppStore()
  const [spots, setSpots] = useState<SpotColorInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState('')

  const isPdf = selectedFile && !selectedFile.isDirectory &&
    ['.pdf', '.ai'].includes(selectedFile.extension?.toLowerCase() || '')

  useEffect(() => {
    if (!isPdf || !selectedFile) {
      setSpots([])
      return
    }

    setLoading(true)
    window.api.tools.extractSpotColors(selectedFile.path)
      .then(result => setSpots(result))
      .catch(() => setSpots([]))
      .finally(() => setLoading(false))
  }, [selectedFile?.path])

  const copyValue = (val: string) => {
    navigator.clipboard.writeText(val)
    setCopied(val)
    setTimeout(() => setCopied(''), 1500)
  }

  if (!isPdf) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <Droplet size={28} style={{ color: '#475569', margin: '0 auto 8px' }} />
        <div style={{ fontSize: 12, color: '#64748b' }}>Επιλέξτε PDF/AI αρχείο</div>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <Loader2 size={20} className="animate-spin" style={{ color: '#f58220', margin: '0 auto 8px' }} />
        <div style={{ fontSize: 12, color: '#64748b' }}>Ανάλυση spot colors...</div>
      </div>
    )
  }

  if (spots.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <Droplet size={28} style={{ color: '#22c55e', margin: '0 auto 8px' }} />
        <div style={{ fontSize: 13, color: '#22c55e', fontWeight: 600 }}>Καμία spot color</div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Μόνο process colors (CMYK)</div>
      </div>
    )
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <AlertTriangle size={14} style={{ color: '#eab308' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#eab308' }}>
          {spots.length} Spot Color{spots.length > 1 ? 's' : ''}
        </span>
      </div>

      {spots.map((spot, i) => (
        <div key={i} style={{
          padding: '10px 12px', borderRadius: 8,
          background: 'var(--th-bg-primary)', border: '1px solid var(--th-border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Color swatch if we have Pantone match */}
            {spot.pantoneMatch ? (
              <div style={{
                width: 32, height: 32, borderRadius: 6, flexShrink: 0,
                background: spot.pantoneMatch.hex,
                border: '1px solid rgba(255,255,255,0.1)',
              }} />
            ) : (
              <div style={{
                width: 32, height: 32, borderRadius: 6, flexShrink: 0,
                background: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Droplet size={14} style={{ color: '#fff' }} />
              </div>
            )}

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 13, fontWeight: 600, color: 'var(--th-text-primary)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {spot.name}
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                Alternate: {spot.alternateSpace}
              </div>
            </div>

            <button onClick={() => copyValue(spot.name)}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b', padding: 4 }}>
              {copied === spot.name ? <Check size={12} style={{ color: '#22c55e' }} /> : <Copy size={12} />}
            </button>
          </div>

          {/* Pantone match details */}
          {spot.pantoneMatch && (
            <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--th-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600 }}>Pantone Match:</span>
              <span style={{ fontSize: 11, color: '#cbd5e1' }}>{spot.pantoneMatch.name}</span>
              <span style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace' }}>
                C{spot.pantoneMatch.c} M{spot.pantoneMatch.m} Y{spot.pantoneMatch.y} K{spot.pantoneMatch.k}
              </span>
            </div>
          )}
        </div>
      ))}

      <div style={{ padding: '8px 10px', borderRadius: 6, background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.2)', fontSize: 11, color: '#eab308' }}>
        Οι spot colors απαιτούν ξεχωριστή πλάκα εκτύπωσης. Αν η δουλειά είναι CMYK, μετατρέψτε τις.
      </div>
    </div>
  )
}
