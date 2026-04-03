import { useState, useCallback } from 'react'
import { Download, RefreshCw } from 'lucide-react'

type BarcodeType = 'ean13' | 'code128' | 'qr'

export function BarcodeGenerator() {
  const [type, setType] = useState<BarcodeType>('ean13')
  const [data, setData] = useState('')
  const [svgOutput, setSvgOutput] = useState('')
  const [generating, setGenerating] = useState(false)

  const generate = useCallback(async () => {
    if (!data.trim()) return
    setGenerating(true)
    try {
      const svg = await window.api.tools.generateBarcode(type, data.trim())
      setSvgOutput(svg)
    } catch (err) {
      console.error('Barcode gen error:', err)
    }
    setGenerating(false)
  }, [type, data])

  const save = useCallback(async (format: 'svg' | 'png') => {
    if (!svgOutput) return
    await window.api.tools.saveBarcodeImage(svgOutput, format)
  }, [svgOutput])

  const placeholders: Record<BarcodeType, string> = {
    ean13: '5901234123457',
    code128: 'PRESSCAL-001',
    qr: 'https://presscal.gr',
  }

  const inp: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: 8,
    background: 'var(--th-bg-primary)', border: '1px solid var(--th-border)',
    color: 'var(--th-text-primary)', fontSize: 13, outline: 'none',
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Type selector */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--th-bg-primary)', borderRadius: 8, padding: 3 }}>
        {([
          { id: 'ean13' as const, label: 'EAN-13' },
          { id: 'code128' as const, label: 'Code 128' },
          { id: 'qr' as const, label: 'QR Code' },
        ]).map(t => (
          <button key={t.id} onClick={() => { setType(t.id); setSvgOutput('') }} style={{
            flex: 1, padding: '6px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600,
            border: 'none', cursor: 'pointer',
            background: type === t.id ? 'rgba(245,130,32,0.15)' : 'transparent',
            color: type === t.id ? '#f58220' : '#94a3b8',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Data input */}
      <div>
        <label style={{ fontSize: 11, color: '#64748b', fontWeight: 600, display: 'block', marginBottom: 4 }}>
          {type === 'ean13' ? 'Αριθμός (12-13 ψηφία)' : type === 'code128' ? 'Κείμενο' : 'Κείμενο / URL'}
        </label>
        <input
          value={data}
          onChange={e => setData(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && generate()}
          placeholder={placeholders[type]}
          style={inp}
        />
      </div>

      {/* Generate button */}
      <button onClick={generate} disabled={!data.trim() || generating} style={{
        padding: '10px 16px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600,
        background: '#f58220', color: '#fff', cursor: 'pointer',
        opacity: !data.trim() || generating ? 0.5 : 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      }}>
        <RefreshCw size={14} className={generating ? 'animate-spin' : ''} />
        Δημιουργία
      </button>

      {/* Preview */}
      {svgOutput && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{
            padding: 16, borderRadius: 10, background: '#ffffff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid var(--th-border)',
          }}>
            <div dangerouslySetInnerHTML={{ __html: svgOutput }} style={{ maxWidth: '100%', overflow: 'auto' }} />
          </div>

          {/* Save buttons */}
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => save('svg')} style={{
              flex: 1, padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              border: '1px solid var(--th-border)', background: 'transparent',
              color: 'var(--th-text-secondary)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <Download size={13} /> Save SVG
            </button>
            <button onClick={() => save('png')} style={{
              flex: 1, padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
              border: '1px solid #f58220', background: 'rgba(245,130,32,0.1)',
              color: '#f58220', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <Download size={13} /> Save PNG
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
