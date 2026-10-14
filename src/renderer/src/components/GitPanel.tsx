import { useEffect, useState } from 'react'
import {
  X,
  GitBranch,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  DownloadCloud,
  UploadCloud,
  GitCommit,
  AlertTriangle
} from 'lucide-react'
import type { GitAction, Project } from '@shared/types'
import { useStore } from '../store'

export function GitPanel({ project, onClose }: { project: Project; onClose: () => void }): JSX.Element {
  const status = useStore((s) => s.gitStatus[project.id])
  const refreshGit = useStore((s) => s.refreshGit)
  const gitAct = useStore((s) => s.gitAct)

  const [busy, setBusy] = useState<GitAction | 'refresh' | null>(null)
  const [message, setMessage] = useState('')
  const [confirmPush, setConfirmPush] = useState(false)

  useEffect(() => {
    setBusy('refresh')
    refreshGit(project).finally(() => setBusy(null))
  }, [project, refreshGit])

  const run = async (action: GitAction): Promise<void> => {
    setBusy(action)
    try {
      const res = await gitAct(project, action, action === 'commit' ? message : undefined)
      if (action === 'commit' && res.ok) setMessage('')
    } finally {
      setBusy(null)
      setConfirmPush(false)
    }
  }

  const notRepo = status && !status.isRepo

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 "
      onClick={onClose}
    >
      <div
        className="w-[480px] rounded-lg bg-bg-panel border border-line shadow-popover"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <GitBranch size={18} className="text-accent" />
            <h2 className="text-md font-medium tracking-tight text-fg">Git — {project.name}</h2>
          </div>
          <button onClick={onClose} className="text-fg-subtle hover:text-fg">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {notRepo ? (
            <p className="text-sm text-fg-muted">This folder isn't a git repository.</p>
          ) : !status ? (
            <p className="text-sm text-fg-subtle">Loading status…</p>
          ) : (
            <>
              {/* Status summary */}
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-bg-soft border border-line">
                  <GitBranch size={14} className="text-fg-muted" />
                  <span className="text-fg font-medium">{status.branch}</span>
                </span>
                {status.hasUpstream && (status.ahead > 0 || status.behind > 0) && (
                  <span className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-bg-soft border border-line text-fg-muted">
                    {status.ahead > 0 && (
                      <span className="flex items-center gap-0.5">
                        <ArrowUp size={13} /> {status.ahead}
                      </span>
                    )}
                    {status.behind > 0 && (
                      <span className="flex items-center gap-0.5">
                        <ArrowDown size={13} /> {status.behind}
                      </span>
                    )}
                  </span>
                )}
                <span
                  className={`px-2.5 py-1 rounded-md border text-xs ${
                    status.dirty
                      ? 'bg-warn/10 border-warn/40 text-warn'
                      : 'bg-ok/10 border-ok/40 text-ok'
                  }`}
                >
                  {status.dirty ? `${status.changedFiles} uncommitted` : 'Clean'}
                </span>
                {!status.hasUpstream && (
                  <span className="px-2.5 py-1 rounded-md bg-bg-soft border border-line text-xs text-fg-subtle">
                    no upstream
                  </span>
                )}
              </div>

              {/* Remote actions */}
              <div className="flex gap-2">
                <GitBtn icon={RefreshCw} label="Fetch" onClick={() => run('fetch')} busy={busy === 'fetch'} />
                <GitBtn
                  icon={DownloadCloud}
                  label="Pull"
                  onClick={() => run('pull')}
                  busy={busy === 'pull'}
                />
                {!confirmPush ? (
                  <GitBtn
                    icon={UploadCloud}
                    label="Push"
                    onClick={() => setConfirmPush(true)}
                    busy={busy === 'push'}
                  />
                ) : (
                  <div className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded-lg bg-warn/10 border border-warn/40">
                    <AlertTriangle size={14} className="text-warn shrink-0" />
                    <span className="text-xs text-amber-200">Push to remote?</span>
                    <button
                      onClick={() => run('push')}
                      className="ml-auto px-2 py-1 rounded-md bg-warn text-black text-xs font-medium"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmPush(false)}
                      className="px-2 py-1 rounded-md text-xs text-fg-muted hover:bg-bg-hover"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              {/* Commit */}
              <div className="pt-1">
                <span className="block mb-1.5 text-xs font-medium text-fg-muted">
                  Stage all &amp; commit
                </span>
                <div className="flex gap-2">
                  <input
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && message.trim()) run('commit')
                    }}
                    placeholder="Commit message…"
                    className="input"
                  />
                  <button
                    onClick={() => run('commit')}
                    disabled={!message.trim() || busy === 'commit'}
                    className="btn-primary"
                  >
                    <GitCommit size={15} /> Commit
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function GitBtn({
  icon: Icon,
  label,
  onClick,
  busy
}: {
  icon: typeof GitBranch
  label: string
  onClick: () => void
  busy: boolean
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="btn-secondary flex-1 justify-center"
    >
      <Icon size={15} className={busy ? 'animate-spin' : ''} /> {label}
    </button>
  )
}
