import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Loader2,
  Square,
  X,
  XCircle
} from 'lucide-react'
import type { Project } from '@shared/types'
import { useStore } from '../store'

/** Live build strip under a project row. Renders nothing until a build exists. */
export function BuildPanel({ project }: { project: Project }): JSX.Element | null {
  const buildId = useStore((s) => s.buildByProject[project.id])
  const build = useStore((s) => (buildId ? s.builds[buildId] : undefined))
  const stopBuild = useStore((s) => s.stopBuild)
  const clearBuild = useStore((s) => s.clearBuild)
  const selectBuild = useStore((s) => s.selectBuild)
  const setView = useStore((s) => s.setView)

  if (!build) return null

  const ok = build.phase === 'succeeded'
  const cancelled = build.phase === 'cancelled'
  const indeterminate = build.running && build.percent === 0

  const barColor = build.running ? 'bg-accent' : ok ? 'bg-ok' : cancelled ? 'bg-fg-faint' : 'bg-danger'

  const statusText = build.running
    ? (build.activity ?? 'Building…')
    : ok
      ? 'Build succeeded'
      : cancelled
        ? 'Build cancelled'
        : (build.message ?? 'Build failed')

  return (
    <div className="pb-2 pl-11 pr-3 pt-0.5" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2">
        {build.running ? (
          <Loader2 size={12} className="shrink-0 animate-spin text-accent" />
        ) : ok ? (
          <CheckCircle2 size={12} className="shrink-0 text-ok" />
        ) : cancelled ? (
          <AlertTriangle size={12} className="shrink-0 text-fg-subtle" />
        ) : (
          <XCircle size={12} className="shrink-0 text-danger" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs text-fg-muted" title={statusText}>
          {statusText}
        </span>

        <button
          onClick={() => {
            selectBuild(build.id)
            setView('instances')
          }}
          className="flex shrink-0 items-center gap-1 text-xs text-fg-subtle hover:text-fg"
        >
          Details <ArrowUpRight size={12} />
        </button>

        {build.running ? (
          <button
            onClick={() => stopBuild(project.id)}
            className="icon-btn h-5 w-5"
            title="Stop build"
          >
            <Square size={13} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={() => clearBuild(project.id)}
            className="btn-icon h-5 w-5"
            title="Dismiss"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-bg-hover">
        {indeterminate ? (
          <div className={`h-full w-1/3 ${barColor} animate-[loading_1s_ease-in-out_infinite]`} />
        ) : (
          <div
            className={`h-full ${barColor} transition-all duration-300`}
            style={{ width: `${ok ? 100 : build.percent}%` }}
          />
        )}
      </div>
    </div>
  )
}
