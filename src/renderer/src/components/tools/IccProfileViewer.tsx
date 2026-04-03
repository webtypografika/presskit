import { useState, useEffect } from 'react'
import { useAppStore } from '@/stores/app-store'
import { Loader2, Monitor, Palette } from 'lucide-react'
import { isImageType } from '@/lib/file-types'

interface IccProfileInfo {
  description: string
  colorSpace: string
  renderingIntent: string
  version: string
  size: number
}

export function IccProfileViewer() {
  const { selectedFile } = useAppStore()
  const [profile, setProfile] = useState<IccProfileInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [noProfile, setNoProfile] = useState(false)

  const canCheck = selectedFile && !selectedFile.isDirectory && isImageType(selectedFile.type)

  useEffect(() => {
    if (!canCheck || !selectedFile) {
      setProfile(null)
      setNoProfile(false)
      return
    }

    setLoading(true)
    window.api.tools.getIccProfile(selectedFile.path)
      .then(result => {
        if (result) {
          setProfile(result)
          setNoProfile(false)
        } else {
          setProfile(null)
          setNoProfile(true)
        }
      })
      .catch(() => { setProfile(null); setNoProfile(true) })
      .finally(() => setLoading(false))
  }, [selectedFile?.path])

  if (!canCheck) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <Monitor size={28} style={{ color: '#475569', margin: '0 auto 8px' }} />
        <div style={{ fontSize: 12, color: '#64748b' }}>Επιλέξτε αρχείο εικόνας</div>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <Loader2 size={20} className="animate-spin" style={{ color: '#f58220', margin: '0 auto 8px' }} />
      </div>
    )
  }

  if (noProfile) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <Monitor size={28} style={{ color: '#eab308', margin: '0 auto 8px' }} />
        <div style={{ fontSize: 13, color: '#eab308', fontWeight: 600 }}>Χωρίς ICC Profile</div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
          Τα χρώματα μπορεί να αλλάξουν κατά την εκτύπωση
        </div>
      </div>
    )
  }

  if (!profile) return null

  const renderingIntentColors: Record<string, string> = {
    'Perceptual': '#3b82f6',
    'Relative Colorimetric': '#22c55e',
    'Saturation': '#f59e0b',
    'Absolute Colorimetric': '#ef4444',
  }

  const rows: { label: string; value: string; color?: string }[] = [
    { label: 'Description', value: profile.description },
    { label: 'Color Space', value: profile.colorSpace, color: profile.colorSpace === 'CMYK' ? '#22c55e' : profile.colorSpace === 'RGB' ? '#3b82f6' : '#64748b' },
    { label: 'Rendering Intent', value: profile.renderingIntent, color: renderingIntentColors[profile.renderingIntent] },
    { label: 'Version', value: profile.version },
    { label: 'Size', value: `${(profile.size / 1024).toFixed(1)} KB` },
  ]

  // Common profile presets
  const wellKnown: Record<string, { label: string; use: string }> = {
    'FOGRA39': { label: 'ISO Coated v2', use: 'Offset εκτύπωση (coated paper)' },
    'FOGRA47': { label: 'Uncoated Yellowish', use: 'Offset εκτύπωση (uncoated paper)' },
    'FOGRA51': { label: 'PSO Coated v3', use: 'Offset εκτύπωση (modern coated)' },
    'FOGRA52': { label: 'PSO Uncoated v3', use: 'Offset εκτύπωση (modern uncoated)' },
    'GRACoL': { label: 'GRACoL 2006', use: 'Commercial printing (US)' },
    'SWOP': { label: 'SWOP v2', use: 'Web offset (US)' },
    'sRGB': { label: 'sRGB', use: 'Web / Screen display' },
    'Adobe RGB': { label: 'Adobe RGB (1998)', use: 'Photography / wide gamut' },
    'ProPhoto': { label: 'ProPhoto RGB', use: 'Ultra-wide gamut photography' },
  }

  const matchedPreset = Object.entries(wellKnown).find(([key]) =>
    profile.description.toLowerCase().includes(key.toLowerCase())
  )

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Profile icon */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: profile.colorSpace === 'CMYK' ? 'rgba(34,197,94,0.1)' : 'rgba(59,130,246,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Palette size={18} style={{ color: profile.colorSpace === 'CMYK' ? '#22c55e' : '#3b82f6' }} />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--th-text-primary)' }}>
            {profile.description}
          </div>
          {matchedPreset && (
            <div style={{ fontSize: 11, color: '#64748b' }}>{matchedPreset[1].use}</div>
          )}
        </div>
      </div>

      {/* Details */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map(row => (
          <div key={row.label} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 10px', borderRadius: 6, background: 'var(--th-bg-primary)',
          }}>
            <span style={{ fontSize: 12, color: '#64748b' }}>{row.label}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: row.color || 'var(--th-text-primary)' }}>{row.value}</span>
          </div>
        ))}
      </div>

      {/* Preset info */}
      {matchedPreset && (
        <div style={{
          padding: '8px 10px', borderRadius: 6,
          background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)',
          fontSize: 11, color: '#22c55e',
        }}>
          Γνωστό ICC profile: {matchedPreset[1].label}
        </div>
      )}

      {/* Print recommendation */}
      {profile.colorSpace === 'RGB' && (
        <div style={{
          padding: '8px 10px', borderRadius: 6,
          background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.2)',
          fontSize: 11, color: '#eab308',
        }}>
          RGB profile — μετατρέψτε σε CMYK (FOGRA39/51) για εκτύπωση
        </div>
      )}
    </div>
  )
}
