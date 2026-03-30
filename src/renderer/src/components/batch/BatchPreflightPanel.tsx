import { useState, useEffect, useCallback, useRef } from 'react'
import { useAppStore } from '@/stores/app-store'
import {
  Scan, FolderOpen, Play, Download, Loader2,
  CheckCircle, AlertTriangle, XCircle, FileText,
  ToggleLeft, ToggleRight
} from 'lucide-react'
import { formatFileSize } from '@/lib/file-types'

interface BatchReport {
  fileName: string
  fileType: string
  overallStatus: 'pass' | 'warning' | 'error'
  checks: any[]
  timestamp: string
}

interface Progress {
  current: number
  total: number
  file: string
  phase: string
}

export function BatchPreflightPanel({ onClose }: { onClose: () => void }) {
  const { currentPath } = useAppStore()
  const [folderPath, setFolderPath] = useState(currentPath)
  const [recursive, setRecursive] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [running, setRunning] = useState(false)
  const [files, setFiles] = useState<string[]>([])
  const [reports, setReports] = useState<BatchReport[]>([])
  const [progress, setProgress] = useState<Progress | null>(null)
  const [selectedReport, setSelectedReport] = useState<BatchReport | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  // Listen for progress updates
  useEffect(() => {
    cleanupRef.current = window.api.batch.onProgress(setProgress)
    return () => cleanupRef.current?.()
  }, [])

  const scanFolder = useCallback(async () => {
    setScanning(true)
    setFiles([])
    setReports([])
    setSelectedReport(null)

    try {
      const found = await window.api.batch.scanDirectory(folderPath, recursive)
      setFiles(found)
    } catch {
      // Error handling
    } finally {
      setScanning(false)
    }
  }, [folderPath, recursive])

  const pickFolder = useCallback(async () => {
    const dir = await window.api.dialog.openDirectory()
    if (dir) {
      setFolderPath(dir)
    }
  }, [])

  const runPreflight = useCallback(async () => {
    if (files.length === 0) return
    setRunning(true)
    setReports([])
    setSelectedReport(null)

    try {
      const results = await window.api.batch.preflight(files)
      setReports(results)
    } catch {
      // Error
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }, [files])

  const exportCsv = useCallback(async () => {
    if (reports.length === 0) return
    const csv = await window.api.batch.exportCsv(reports)
    const path = await window.api.convert.saveDialog('preflight_report.csv')
    if (path) {
      // Write CSV file
      const blob = new Blob([csv], { type: 'text/csv' })
      // Use fetch to convert to array buffer then write via IPC
      // For simplicity, download via data URL trick won't work in Electron
      // So we'll handle this in main process
    }
  }, [reports])

  const statusCounts = {
    pass: reports.filter(r => r.overallStatus === 'pass').length,
    warning: reports.filter(r => r.overallStatus === 'warning').length,
    error: reports.filter(r => r.overallStatus === 'error').length
  }

  return (
    <div className="h-full flex flex-col bg-bg-secondary">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border" style={{ padding: '14px 20px' }}>
        <div className="flex items-center gap-2">
          <Scan size={16} className="text-accent" />
          <span className="text-sm font-medium">Batch Preflight</span>
        </div>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary text-xs">Close</button>
      </div>

      {/* Folder selection */}
      <div className="border-b border-border" style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={folderPath}
            onChange={e => setFolderPath(e.target.value)}
            className="flex-1 px-3 py-2.5 bg-bg-primary border border-border rounded-lg text-sm text-text-primary font-mono focus:border-accent focus:outline-none"
            placeholder="Folder path..."
          />
          <button
            onClick={pickFolder}
            className="p-1.5 bg-bg-primary border border-border rounded hover:bg-bg-hover"
            title="Browse"
          >
            <FolderOpen size={14} className="text-text-secondary" />
          </button>
        </div>

        <div className="flex items-center justify-between">
          <button
            className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
            onClick={() => setRecursive(!recursive)}
          >
            {recursive ? <ToggleRight size={16} className="text-accent" /> : <ToggleLeft size={16} />}
            Include subfolders
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={scanFolder}
              disabled={scanning || !folderPath}
              className="px-3 py-1 bg-bg-hover rounded text-xs text-text-secondary hover:text-text-primary disabled:opacity-50"
            >
              {scanning ? 'Scanning...' : 'Scan'}
            </button>
            <button
              onClick={runPreflight}
              disabled={running || files.length === 0}
              className="flex items-center gap-1 px-3 py-1 bg-accent/10 text-accent rounded text-xs hover:bg-accent/20 disabled:opacity-50"
            >
              <Play size={12} />
              {running ? 'Running...' : `Run (${files.length})`}
            </button>
          </div>
        </div>
      </div>

      {/* Progress */}
      {running && progress && (
        <div className="border-b border-border bg-bg-primary" style={{ padding: '10px 20px' }}>
          <div className="flex items-center justify-between text-sm text-text-secondary mb-1">
            <span>{progress.current} / {progress.total}</span>
            <span className="truncate ml-2 text-text-muted">{progress.file.split(/[/\\]/).pop()}</span>
          </div>
          <div className="h-1 bg-bg-hover rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Results summary */}
      {reports.length > 0 && (
        <div className="flex items-center gap-4 border-b border-border" style={{ padding: '10px 20px' }}>
          <span className="flex items-center gap-1 text-xs text-success">
            <CheckCircle size={13} /> {statusCounts.pass}
          </span>
          <span className="flex items-center gap-1 text-xs text-warning">
            <AlertTriangle size={13} /> {statusCounts.warning}
          </span>
          <span className="flex items-center gap-1 text-xs text-error">
            <XCircle size={13} /> {statusCounts.error}
          </span>
          <div className="flex-1" />
          <button
            onClick={exportCsv}
            className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
          >
            <Download size={12} /> Export CSV
          </button>
        </div>
      )}

      {/* Results list */}
      <div className="flex-1 flex overflow-hidden">
        {/* File list */}
        <div className="w-1/2 overflow-y-auto border-r border-border">
          {reports.length > 0 ? (
            reports.map((report, i) => {
              const statusIcon = report.overallStatus === 'pass'
                ? <CheckCircle size={13} className="text-success" />
                : report.overallStatus === 'warning'
                  ? <AlertTriangle size={13} className="text-warning" />
                  : <XCircle size={13} className="text-error" />

              return (
                <div
                  key={i}
                  className={`flex items-center gap-2 cursor-pointer text-xs ${
                    selectedReport === report ? 'bg-bg-active' : 'hover:bg-bg-hover'
                  }`}
                  style={{ padding: '10px 16px' }}
                  onClick={() => setSelectedReport(report)}
                >
                  {statusIcon}
                  <span className="truncate text-text-secondary">{report.fileName}</span>
                  <span className="ml-auto text-xs text-text-muted">
                    {report.checks.length} checks
                  </span>
                </div>
              )
            })
          ) : files.length > 0 ? (
            files.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-text-muted" style={{ padding: '10px 16px' }}>
                <FileText size={13} />
                <span className="truncate">{f.split(/[/\\]/).pop()}</span>
              </div>
            ))
          ) : (
            <div className="flex items-center justify-center h-full text-text-muted text-xs">
              Scan a folder to begin
            </div>
          )}
        </div>

        {/* Detail view */}
        <div className="w-1/2 overflow-y-auto" style={{ padding: 20 }}>
          {selectedReport ? (
            <div className="space-y-2">
              <div className="text-xs font-medium text-text-primary mb-2">{selectedReport.fileName}</div>
              {selectedReport.checks.map((check, i) => {
                const colors = {
                  pass: 'text-success bg-success/10',
                  warning: 'text-warning bg-warning/10',
                  error: 'text-error bg-error/10',
                  info: 'text-info bg-info/10'
                }
                return (
                  <div key={i} className={`px-2 py-1.5 rounded text-sm ${colors[check.severity as keyof typeof colors]}`}>
                    <div className="flex justify-between">
                      <span>{check.label}</span>
                      <span className="font-medium">{check.value}</span>
                    </div>
                    {check.detail && <div className="text-xs opacity-70 mt-0.5">{check.detail}</div>}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-text-muted text-xs">
              Select a file to see details
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
