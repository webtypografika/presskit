import { useAppStore } from '@/stores/app-store'
import { CheckCircle, AlertTriangle, XCircle, Info, Loader2, Scan } from 'lucide-react'
import type { Severity, PreflightCheck } from '@/lib/file-types'

const severityConfig: Record<Severity, { icon: React.ReactNode; color: string; bg: string }> = {
  pass: {
    icon: <CheckCircle size={14} />,
    color: 'text-success',
    bg: 'bg-success/10'
  },
  warning: {
    icon: <AlertTriangle size={14} />,
    color: 'text-warning',
    bg: 'bg-warning/10'
  },
  error: {
    icon: <XCircle size={14} />,
    color: 'text-error',
    bg: 'bg-error/10'
  },
  info: {
    icon: <Info size={14} />,
    color: 'text-info',
    bg: 'bg-info/10'
  }
}

export function PreflightReport() {
  const { preflight, preflightLoading, selectedFile, runPreflight } = useAppStore()

  if (preflightLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2">
        <Loader2 size={24} className="animate-spin text-accent" />
        <span className="text-xs text-text-muted">Running preflight checks...</span>
      </div>
    )
  }

  if (!preflight) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-3">
        <Scan size={32} className="text-text-muted" />
        <div className="text-center">
          <div className="text-xs text-text-secondary">No preflight report</div>
          <div className="text-sm text-text-muted mt-0.5">Click the button to run preflight checks</div>
        </div>
        <button
          className="px-4 py-1.5 bg-accent/10 text-accent rounded text-xs hover:bg-accent/20 transition-colors"
          onClick={runPreflight}
          disabled={!selectedFile || selectedFile.isDirectory}
        >
          Run Preflight
        </button>
      </div>
    )
  }

  const statusConfig = {
    pass: { label: 'PASS', color: 'text-success', bg: 'bg-success/10', border: 'border-success/30' },
    warning: { label: 'WARNING', color: 'text-warning', bg: 'bg-warning/10', border: 'border-warning/30' },
    error: { label: 'FAIL', color: 'text-error', bg: 'bg-error/10', border: 'border-error/30' }
  }

  const status = statusConfig[preflight.overallStatus]

  return (
    <div className="p-4 space-y-3">
      {/* Overall status */}
      <div className={`flex items-center justify-between p-2.5 rounded-lg border ${status.bg} ${status.border}`}>
        <div>
          <div className="text-xs text-text-secondary">{preflight.fileName}</div>
          <div className={`text-sm font-semibold ${status.color}`}>{status.label}</div>
        </div>
        <div className="text-right">
          <div className="text-sm text-text-muted">{preflight.checks.length} checks</div>
          <div className="text-xs text-text-muted">
            {new Date(preflight.timestamp).toLocaleTimeString('el-GR')}
          </div>
        </div>
      </div>

      {/* Checks grouped by severity */}
      {(['error', 'warning', 'pass', 'info'] as Severity[]).map(severity => {
        const checks = preflight.checks.filter(c => c.severity === severity)
        if (checks.length === 0) return null

        return (
          <div key={severity}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className={severityConfig[severity].color}>
                {severityConfig[severity].icon}
              </span>
              <span className="text-sm font-medium text-text-muted uppercase tracking-wider">
                {severity === 'pass' ? 'Passed' : severity === 'info' ? 'Info' : severity === 'warning' ? 'Warnings' : 'Errors'}
                <span className="ml-1 text-text-muted">({checks.length})</span>
              </span>
            </div>

            <div className="space-y-1 ml-5">
              {checks.map(check => (
                <CheckRow key={check.id} check={check} />
              ))}
            </div>
          </div>
        )
      })}

      {/* Re-run button */}
      <button
        className="w-full py-1.5 bg-bg-hover rounded text-xs text-text-secondary hover:bg-bg-active transition-colors"
        onClick={runPreflight}
      >
        Re-run Preflight
      </button>
    </div>
  )
}

function CheckRow({ check }: { check: PreflightCheck }) {
  const config = severityConfig[check.severity]

  return (
    <div className={`px-2 py-1.5 rounded ${config.bg}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-text-secondary">{check.label}</span>
        <span className={`text-sm font-medium ${config.color}`}>{check.value}</span>
      </div>
      {check.detail && (
        <div className="text-xs text-text-muted mt-0.5">{check.detail}</div>
      )}
    </div>
  )
}
