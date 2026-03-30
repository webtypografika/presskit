import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@/stores/app-store'
import {
  Briefcase, Loader2, Link2,
  Clock, AlertTriangle, Zap
} from 'lucide-react'
import type { PresscalJob } from '@/lib/ipc'

const STAGES = ['files', 'printing', 'cutting', 'finishing', 'delivery'] as const
const STAGE_LABELS: Record<string, string> = {
  files: 'Files',
  printing: 'Printing',
  cutting: 'Cutting',
  finishing: 'Finishing',
  delivery: 'Delivery'
}

const PRIORITY_ICONS: Record<string, React.ReactNode> = {
  normal: <Clock size={12} className="text-text-muted" />,
  urgent: <AlertTriangle size={12} className="text-warning" />,
  rush: <Zap size={12} className="text-error" />
}

export function JobFiles() {
  const { selectedFile, preflight } = useAppStore()
  const [jobs, setJobs] = useState<PresscalJob[]>([])
  const [loading, setLoading] = useState(false)
  const [linkingTo, setLinkingTo] = useState<string | null>(null)
  const [filterStage, setFilterStage] = useState<string>('')

  useEffect(() => {
    setLoading(true)
    window.api.presscal.getJobs(filterStage ? { stage: filterStage } : undefined)
      .then(setJobs)
      .catch(() => setJobs([]))
      .finally(() => setLoading(false))
  }, [filterStage])

  const linkToJob = useCallback(async (jobId: string) => {
    if (!selectedFile || selectedFile.isDirectory) return
    setLinkingTo(jobId)
    try {
      await window.api.presscal.linkFile({
        fileName: selectedFile.name,
        filePath: selectedFile.path,
        fileType: selectedFile.extension,
        fileSize: selectedFile.size,
        source: 'local',
        quoteId: jobId,
        preflightStatus: preflight?.overallStatus || undefined
      })
    } catch {
    } finally {
      setLinkingTo(null)
    }
  }, [selectedFile, preflight])

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Stage filter */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        <button
          className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
            !filterStage ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover'
          }`}
          onClick={() => setFilterStage('')}
        >
          All
        </button>
        {STAGES.map(stage => (
          <button
            key={stage}
            className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
              filterStage === stage ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover'
            }`}
            onClick={() => setFilterStage(stage)}
          >
            {STAGE_LABELS[stage]}
          </button>
        ))}
      </div>

      {/* Job list */}
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 size={20} className="animate-spin text-text-muted" />
        </div>
      ) : (
        <div className="space-y-1.5">
          {jobs.map(job => (
            <div
              key={job.id}
              className="px-3 py-3 rounded-lg hover:bg-bg-hover group cursor-pointer"
              onClick={() => linkToJob(job.id)}
            >
              <div className="flex items-center gap-3">
                <Briefcase size={18} className="text-accent flex-shrink-0" />

                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-accent">{job.number}</span>
                    {PRIORITY_ICONS[job.jobPriority]}
                  </div>
                  <div className="text-sm text-text-secondary truncate leading-relaxed">
                    {job.title || job.customerName || 'Untitled'}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-1 rounded-md bg-bg-primary text-text-muted">
                    {STAGE_LABELS[job.jobStage] || job.jobStage}
                  </span>
                  {linkingTo === job.id ? (
                    <Loader2 size={15} className="animate-spin text-accent" />
                  ) : (
                    <Link2 size={15} className="text-text-muted opacity-0 group-hover:opacity-100" />
                  )}
                </div>
              </div>

              {job.deadline && (
                <div className="text-sm text-text-muted mt-1.5 ml-8">
                  Deadline: {new Date(job.deadline).toLocaleDateString('el-GR')}
                </div>
              )}
            </div>
          ))}

          {jobs.length === 0 && !loading && (
            <div className="text-center py-8 text-sm text-text-muted">
              No active jobs
            </div>
          )}
        </div>
      )}
    </div>
  )
}
