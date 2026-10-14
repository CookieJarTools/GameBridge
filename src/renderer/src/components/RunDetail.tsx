import { Hammer, PlugZap, Square, X } from 'lucide-react'
import { useStore, type RunUi } from '../store'
import { LogViewer } from './LogViewer'
import { RunIcon } from './InstanceIcons'

/** A running game or a watched editor log. */
export function RunDetail({ projectId, run }: { projectId: string; run: RunUi }): JSX.Element {
  const projects = useStore((s) => s.projects)
  const stopRun = useStore((s) => s.stopRun)
  const reattachRun = useStore((s) => s.reattachRun)
  const clearRun = useStore((s) => s.clearRun)
  const startBuild = useStore((s) => s.startBuild)

  const project = projects.find((p) => p.id === projectId)
  const name = project?.name ?? 'Unknown'

  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <RunIcon run={run} size={13} />
        <span className="text-base font-medium text-fg">
          {run.running
            ? 'running'
            : run.canReattach
              ? 'not watching — editor still open'
              : run.crashed
                ? `crashed (exit ${run.exitCode ?? run.signal})`
                : 'exited cleanly'}
        </span>
        <span className="text-sm tabular-nums text-fg-faint">{run.lines.length} lines</span>

        <div className="ml-auto flex items-center gap-1">
          {project && (
            <button
              onClick={() => startBuild(project)}
              className="btn-secondary"
              title="Build this project"
            >
              <Hammer size={13} /> Build
            </button>
          )}
          {run.running ? (
            <button onClick={() => stopRun(projectId)} className="btn-secondary hover:text-danger">
              <Square size={11} fill="currentColor" /> Stop
            </button>
          ) : (
            <>
              {run.canReattach && (
                <button
                  onClick={() => reattachRun(projectId)}
                  className="btn bg-accent/15 text-accent hover:bg-accent/25"
                  title="Pick the editor log back up where we left off"
                >
                  <PlugZap size={13} /> Reconnect
                </button>
              )}
              <button onClick={() => clearRun(projectId)} className="btn-secondary">
                <X size={13} /> Clear
              </button>
            </>
          )}
        </div>
      </div>

      {/* Remounted per run so filters/folds don't leak between sessions. */}
      <LogViewer key={projectId} lines={run.lines} />
    </>
  )
}
