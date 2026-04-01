import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAppStore } from '@/stores/app-store'
import {
  Briefcase, Loader2, Link2, Search,
  Clock, AlertTriangle, Zap
} from 'lucide-react'
import type { PresscalJob } from '@/lib/ipc'
import { fuzzyMatch } from '@/lib/fuzzy'

const PAGE_SIZE = 50

const PRIORITY_ICONS: Record<string, React.ReactNode> = {
  normal: <Clock size={12} style={{ color: 'var(--th-text-muted)' }} />,
  urgent: <AlertTriangle size={12} style={{ color: '#eab308' }} />,
  rush: <Zap size={12} style={{ color: '#ef4444' }} />
}

export function JobFiles() {
  const { selectedFile, preflight } = useAppStore()
  const [allJobs, setAllJobs] = useState<PresscalJob[]>([])
  const [loading, setLoading] = useState(false)
  const [linkingTo, setLinkingTo] = useState<string | null>(null)
  const [filterStage, setFilterStage] = useState<string>('')
  const [search, setSearch] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  // Fetch all jobs
  const fetchJobs = useCallback(() => {
    setLoading(true)
    window.api.presscal.getJobs()
      .then(jobs => { setAllJobs(jobs); setVisibleCount(PAGE_SIZE) })
      .catch(() => setAllJobs([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchJobs() }, [fetchJobs])

  // Extract unique stages dynamically from jobs data
  const stages = useMemo(() => {
    const stageSet = new Set<string>()
    for (const job of allJobs) {
      if (job.jobStage) stageSet.add(job.jobStage)
    }
    return Array.from(stageSet)
  }, [allJobs])

  // Filter & search
  const filteredJobs = useMemo(() => {
    let result = allJobs
    if (filterStage) {
      result = result.filter(j => j.jobStage === filterStage)
    }
    if (search.trim()) {
      result = result.filter(j => {
        const text = [j.number, j.title, j.customerName].filter(Boolean).join(' ')
        return fuzzyMatch(text, search)
      })
    }
    return result
  }, [allJobs, filterStage, search])

  const visibleJobs = filteredJobs.slice(0, visibleCount)
  const hasMore = visibleCount < filteredJobs.length

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
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Search */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', height: 36, background: 'var(--th-bg-primary)', borderRadius: 8 }}>
        <Search size={14} style={{ color: 'var(--th-text-muted)', flexShrink: 0 }} />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search jobs..."
          style={{
            border: 'none', background: 'transparent', color: 'var(--th-text-primary)',
            fontSize: 13, outline: 'none', width: '100%', padding: 0, margin: 0,
          }}
        />
      </div>

      {/* Stage filter — dynamic from data */}
      {stages.length > 0 && (
        <div className="flex items-center" style={{ gap: 4, flexWrap: 'wrap' }}>
          <button
            style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 11, border: 'none', cursor: 'pointer',
              background: !filterStage ? 'rgba(245,130,32,0.12)' : 'transparent',
              color: !filterStage ? '#f58220' : 'var(--th-text-muted)',
            }}
            onClick={() => setFilterStage('')}
          >
            All
          </button>
          {stages.map(stage => (
            <button
              key={stage}
              style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11, border: 'none', cursor: 'pointer',
                background: filterStage === stage ? 'rgba(245,130,32,0.12)' : 'transparent',
                color: filterStage === stage ? '#f58220' : 'var(--th-text-muted)',
                textTransform: 'capitalize',
              }}
              onClick={() => setFilterStage(stage)}
            >
              {stage}
            </button>
          ))}
        </div>
      )}

      {/* Job list */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--th-text-muted)' }} />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {visibleJobs.map(job => (
            <div
              key={job.id}
              style={{ padding: '10px 12px', borderRadius: 8, cursor: 'pointer' }}
              className="group"
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--th-bg-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              onClick={() => linkToJob(job.id)}
            >
              <div className="flex items-center" style={{ gap: 10 }}>
                <Briefcase size={16} style={{ color: '#f58220', flexShrink: 0 }} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="flex items-center" style={{ gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#f58220' }}>{job.number}</span>
                    {PRIORITY_ICONS[job.jobPriority]}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--th-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {job.title || job.customerName || 'Untitled'}
                  </div>
                </div>

                <div className="flex items-center" style={{ gap: 6, flexShrink: 0 }}>
                  <span style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 4,
                    background: 'var(--th-bg-primary)', color: 'var(--th-text-muted)',
                    textTransform: 'capitalize',
                  }}>
                    {job.jobStage}
                  </span>
                  {linkingTo === job.id ? (
                    <Loader2 size={14} className="animate-spin" style={{ color: '#f58220' }} />
                  ) : (
                    <Link2 size={14} className="opacity-0 group-hover:opacity-100" style={{ color: 'var(--th-text-muted)' }} />
                  )}
                </div>
              </div>

              {job.deadline && (
                <div style={{ fontSize: 11, color: 'var(--th-text-muted)', marginTop: 4, marginLeft: 26 }}>
                  Deadline: {new Date(job.deadline).toLocaleDateString('el-GR')}
                </div>
              )}
            </div>
          ))}

          {/* Load more */}
          {hasMore && (
            <button
              onClick={() => setVisibleCount(v => v + PAGE_SIZE)}
              style={{
                padding: '8px 0', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: 12, color: '#f58220', textAlign: 'center',
              }}
            >
              Show more ({filteredJobs.length - visibleCount} remaining)
            </button>
          )}

          {filteredJobs.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: 32, fontSize: 13, color: 'var(--th-text-muted)' }}>
              {search || filterStage ? 'No jobs found' : 'No active jobs'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
