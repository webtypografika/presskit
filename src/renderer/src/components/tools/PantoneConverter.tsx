import { useState, useCallback, useRef } from 'react'
import { Search, ArrowRightLeft, Copy, Check } from 'lucide-react'

interface PantoneColor {
  name: string
  c: number; m: number; y: number; k: number
  r: number; g: number; b: number
  hex: string
}

export function PantoneConverter() {
  const [mode, setMode] = useState<'search' | 'rgb' | 'cmyk'>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PantoneColor[]>([])
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState('')
  const timerRef = useRef<any>(null)

  // RGB inputs
  const [r, setR] = useState(0)
  const [g, setG] = useState(0)
  const [b, setB] = useState(0)

  // CMYK inputs
  const [c, setC] = useState(0)
  const [m, setM] = useState(0)
  const [y, setY] = useState(0)
  const [k, setK] = useState(0)

  // Conversion results
  const [convertedCmyk, setConvertedCmyk] = useState<{c:number;m:number;y:number;k:number}|null>(null)
  const [convertedRgb, setConvertedRgb] = useState<{r:number;g:number;b:number}|null>(null)

  const doSearch = useCallback(async (q: string) => {
    setLoading(true)
    try {
      const res = await window.api.tools.pantoneSearch(q)
      setResults(res)
    } catch {
      setResults([])
    }
    setLoading(false)
  }, [])

  const handleSearchInput = useCallback((val: string) => {
    setQuery(val)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSearch(val), 300)
  }, [doSearch])

  const findFromRgb = useCallback(async () => {
    setLoading(true)
    try {
      const [pantones, cmyk] = await Promise.all([
        window.api.tools.pantoneFromRgb(r, g, b, 8),
        window.api.tools.rgbToCmyk(r, g, b),
      ])
      setResults(pantones)
      setConvertedCmyk(cmyk)
    } catch {}
    setLoading(false)
  }, [r, g, b])

  const convertCmykToRgb = useCallback(async () => {
    setLoading(true)
    try {
      const rgb = await window.api.tools.cmykToRgb(c, m, y, k)
      setConvertedRgb(rgb)
      // Also find closest Pantone
      const pantones = await window.api.tools.pantoneFromRgb(rgb.r, rgb.g, rgb.b, 8)
      setResults(pantones)
    } catch {}
    setLoading(false)
  }, [c, m, y, k])

  const copyValue = (val: string) => {
    navigator.clipboard.writeText(val)
    setCopied(val)
    setTimeout(() => setCopied(''), 1500)
  }

  const inp: React.CSSProperties = {
    width: '100%', padding: '6px 10px', borderRadius: 6,
    background: 'var(--th-bg-primary)', border: '1px solid var(--th-border)',
    color: 'var(--th-text-primary)', fontSize: 13, outline: 'none',
  }

  const numInp: React.CSSProperties = {
    ...inp, width: 52, textAlign: 'center' as const, padding: '6px 4px',
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: 4, background: 'var(--th-bg-primary)', borderRadius: 8, padding: 3 }}>
        {(['search', 'rgb', 'cmyk'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)} style={{
            flex: 1, padding: '6px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600,
            border: 'none', cursor: 'pointer',
            background: mode === m ? 'rgba(110,200,200,0.15)' : 'transparent',
            color: mode === m ? '#6ec8c8' : '#94a3b8',
          }}>
            {m === 'search' ? 'Pantone' : m.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Search mode */}
      {mode === 'search' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Search size={14} style={{ color: '#64748b', flexShrink: 0 }} />
          <input
            value={query}
            onChange={e => handleSearchInput(e.target.value)}
            placeholder="π.χ. 485, Red, Warm Gray..."
            style={inp}
            autoFocus
          />
        </div>
      )}

      {/* RGB mode */}
      {mode === 'rgb' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 32, height: 32, borderRadius: 6, border: '1px solid var(--th-border)', background: `rgb(${r},${g},${b})`, flexShrink: 0 }} />
            <label style={{ fontSize: 11, color: '#ef4444', width: 12 }}>R</label>
            <input type="number" min={0} max={255} value={r} onChange={e => setR(Number(e.target.value))} style={numInp} />
            <label style={{ fontSize: 11, color: '#22c55e', width: 12 }}>G</label>
            <input type="number" min={0} max={255} value={g} onChange={e => setG(Number(e.target.value))} style={numInp} />
            <label style={{ fontSize: 11, color: '#3b82f6', width: 12 }}>B</label>
            <input type="number" min={0} max={255} value={b} onChange={e => setB(Number(e.target.value))} style={numInp} />
          </div>
          <button onClick={findFromRgb} style={{
            padding: '8px 16px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 600,
            background: '#6ec8c8', color: '#fff', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <ArrowRightLeft size={14} /> Μετατροπή & Αναζήτηση Pantone
          </button>
          {convertedCmyk && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, background: 'rgba(110,200,200,0.06)', border: '1px solid rgba(110,200,200,0.2)' }}>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>CMYK:</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', fontFamily: 'monospace' }}>
                {convertedCmyk.c}/{convertedCmyk.m}/{convertedCmyk.y}/{convertedCmyk.k}
              </span>
              <button onClick={() => copyValue(`${convertedCmyk.c}/${convertedCmyk.m}/${convertedCmyk.y}/${convertedCmyk.k}`)}
                style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b', padding: 4 }}>
                {copied === `${convertedCmyk.c}/${convertedCmyk.m}/${convertedCmyk.y}/${convertedCmyk.k}` ? <Check size={12} style={{ color: '#22c55e' }} /> : <Copy size={12} />}
              </button>
            </div>
          )}
        </div>
      )}

      {/* CMYK mode */}
      {mode === 'cmyk' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <label style={{ fontSize: 11, color: '#00bcd4', width: 14 }}>C</label>
            <input type="number" min={0} max={100} value={c} onChange={e => setC(Number(e.target.value))} style={numInp} />
            <label style={{ fontSize: 11, color: '#e91e63', width: 14 }}>M</label>
            <input type="number" min={0} max={100} value={m} onChange={e => setM(Number(e.target.value))} style={numInp} />
            <label style={{ fontSize: 11, color: '#ffc107', width: 14 }}>Y</label>
            <input type="number" min={0} max={100} value={y} onChange={e => setY(Number(e.target.value))} style={numInp} />
            <label style={{ fontSize: 11, color: '#424242', width: 14 }}>K</label>
            <input type="number" min={0} max={100} value={k} onChange={e => setK(Number(e.target.value))} style={numInp} />
          </div>
          <button onClick={convertCmykToRgb} style={{
            padding: '8px 16px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 600,
            background: '#6ec8c8', color: '#fff', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <ArrowRightLeft size={14} /> Μετατροπή & Αναζήτηση Pantone
          </button>
          {convertedRgb && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, background: 'rgba(110,200,200,0.06)', border: '1px solid rgba(110,200,200,0.2)' }}>
              <div style={{ width: 20, height: 20, borderRadius: 4, background: `rgb(${convertedRgb.r},${convertedRgb.g},${convertedRgb.b})`, border: '1px solid var(--th-border)' }} />
              <span style={{ fontSize: 11, color: '#94a3b8' }}>RGB:</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', fontFamily: 'monospace' }}>
                {convertedRgb.r}, {convertedRgb.g}, {convertedRgb.b}
              </span>
              <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 8 }}>HEX:</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', fontFamily: 'monospace' }}>
                #{convertedRgb.r.toString(16).padStart(2,'0')}{convertedRgb.g.toString(16).padStart(2,'0')}{convertedRgb.b.toString(16).padStart(2,'0')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 400, overflowY: 'auto' }}>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>
            {mode === 'search' ? 'Αποτελέσματα' : 'Κοντινότερα Pantone'}
          </div>
          {results.map((color, i) => (
            <PantoneColorCard key={`${color.name}-${i}`} color={color} copied={copied} onCopy={copyValue} />
          ))}
        </div>
      )}
    </div>
  )
}

function PantoneColorCard({ color, copied, onCopy }: { color: PantoneColor; copied: string; onCopy: (v: string) => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
      borderRadius: 8, background: 'var(--th-bg-primary)', border: '1px solid var(--th-border)',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 6, flexShrink: 0,
        background: color.hex, border: '1px solid rgba(255,255,255,0.1)',
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--th-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {color.name}
        </div>
        <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>
          C{color.c} M{color.m} Y{color.y} K{color.k}
        </div>
        <div style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace' }}>
          RGB({color.r},{color.g},{color.b}) {color.hex}
        </div>
      </div>
      <button onClick={() => onCopy(color.name)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b', padding: 4 }}>
        {copied === color.name ? <Check size={12} style={{ color: '#22c55e' }} /> : <Copy size={12} />}
      </button>
    </div>
  )
}
