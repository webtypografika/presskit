import { useState, useEffect } from 'react'
import { useAppStore } from '@/stores/app-store'
import { CheckCircle, AlertTriangle, XCircle, MinusCircle, Loader2, ClipboardCheck } from 'lucide-react'
import { isPrintFile, isImageType } from '@/lib/file-types'

interface ChecklistItem {
  id: string
  label: string
  status: 'pass' | 'warning' | 'error' | 'na'
  value: string
  detail?: string
  category: 'resolution' | 'color' | 'bleed' | 'fonts' | 'general'
}

const statusConfig = {
  pass: { icon: <CheckCircle size={14} />, color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
  warning: { icon: <AlertTriangle size={14} />, color: '#eab308', bg: 'rgba(234,179,8,0.1)' },
  error: { icon: <XCircle size={14} />, color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  na: { icon: <MinusCircle size={14} />, color: '#64748b', bg: 'rgba(100,116,139,0.1)' },
}

const categoryLabels: Record<string, string> = {
  resolution: 'Ανάλυση',
  color: 'Χρώματα',
  bleed: 'Bleed',
  fonts: 'Γραμματοσειρές',
  general: 'Γενικά',
}

export function PrintChecklist() {
  const { selectedFile } = useAppStore()
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [loading, setLoading] = useState(false)

  const canCheck = selectedFile && !selectedFile.isDirectory &&
    (isPrintFile(selectedFile.type) || isImageType(selectedFile.type))

  useEffect(() => {
    if (!canCheck || !selectedFile) {
      setItems([])
      return
    }

    setLoading(true)
    window.api.tools.printChecklist(selectedFile.path)
      .then(result => setItems(result))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [selectedFile?.path])

  if (!canCheck) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <ClipboardCheck size={28} style={{ color: '#475569', margin: '0 auto 8px' }} />
        <div style={{ fontSize: 12, color: '#64748b' }}>Επιλέξτε αρχείο εκτύπωσης</div>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <Loader2 size={20} className="animate-spin" style={{ color: 'var(--th-accent)', margin: '0 auto 8px' }} />
        <div style={{ fontSize: 12, color: '#64748b' }}>Checking...</div>
      </div>
    )
  }

  const passed = items.filter(i => i.status === 'pass').length
  const warnings = items.filter(i => i.status === 'warning').length
  const errors = items.filter(i => i.status === 'error').length
  const total = items.filter(i => i.status !== 'na').length

  const overallStatus = errors > 0 ? 'error' : warnings > 0 ? 'warning' : 'pass'
  const overallLabel = errors > 0 ? 'NOT READY' : warnings > 0 ? 'NEEDS REVIEW' : 'PRINT READY'

  // Group by category
  const grouped = items.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = []
    acc[item.category].push(item)
    return acc
  }, {} as Record<string, ChecklistItem[]>)

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Overall score */}
      <div style={{
        padding: '12px 16px', borderRadius: 10,
        background: statusConfig[overallStatus].bg,
        border: `1px solid ${statusConfig[overallStatus].color}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>{selectedFile?.name}</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: statusConfig[overallStatus].color }}>
            {overallLabel}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: statusConfig[overallStatus].color }}>
            {passed}/{total}
          </div>
          <div style={{ fontSize: 10, color: '#64748b' }}>checks passed</div>
        </div>
      </div>

      {/* Score bar */}
      <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: '#1e293b' }}>
        {passed > 0 && <div style={{ flex: passed, background: '#22c55e' }} />}
        {warnings > 0 && <div style={{ flex: warnings, background: '#eab308' }} />}
        {errors > 0 && <div style={{ flex: errors, background: '#ef4444' }} />}
      </div>

      {/* Grouped checks */}
      {Object.entries(grouped).map(([category, categoryItems]) => (
        <div key={category}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            {categoryLabels[category] || category}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {categoryItems.map(item => {
              const cfg = statusConfig[item.status]
              return (
                <div key={item.id} style={{
                  padding: '8px 10px', borderRadius: 6,
                  background: cfg.bg,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: cfg.color, flexShrink: 0 }}>{cfg.icon}</span>
                    <span style={{ fontSize: 13, color: '#cbd5e1', flex: 1 }}>{item.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: cfg.color }}>{item.value}</span>
                  </div>
                  {item.detail && (
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, marginLeft: 22 }}>{item.detail}</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
