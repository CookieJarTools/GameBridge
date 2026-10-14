import { useEffect, useMemo, useState } from 'react'
import { FolderOpen, RotateCw, Square, Trash2 } from 'lucide-react'
import type { BuildPhaseId } from '@shared/types'
import { useStore, type BuildUi } from '../store'
import { LogViewer } from './LogViewer'
import { BuildReportPanel } from './BuildReportPanel'
import { AssetAnalysisPanel } from './AssetAnalysisPanel'
import { BuildAssetsPanel } from './BuildAssetsPanel'
import { CleanupPanel } from './CleanupPanel'
import { PublishPanel } from './PublishPanel'
import { bytes, duration } from '../lib/format'
import { StatusIcon } from './InstanceIcons'

type Tab = 'log' | 'report' | 'project' | 'build' | 'cleanup' | 'publish'

export const PHASE_LABEL: Record<BuildPhaseId, string> = {
  'closing-editor': 'Closing editor',
  starting: 'Starting',
  switching: 'Switching platform',
  importing: 'Importing assets',
  compiling: 'Compiling scripts',
  building: 'Building player',
  reporting: 'Writing report',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled'
}

const BASE_STAGES: BuildPhaseId[] = [
  'starting',
  'importing',
  'compiling',
  'building',
  'reporting'
]

/** Live build: phases, controls, and the log/report/assets tabs. */
export function BuildDetail({ build }: { build: BuildUi }): JSX.Element {
  const projects = useStore((s) => s.projects)
  const stopBuild = useStore((s) => s.stopBuild)
  const startBuild = useStore((s) => s.startBuild)
  const forgetBuild = useStore((s) => s.forgetBuild)
  const revealBuild = useStore((s) => s.revealBuild)

  const [tab, setTab] = useState<Tab>('log')
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!build.running) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [build.running])

  const elapsed = ((build.endedAt ?? now) - build.startedAt) / 1000
  const project = projects.find((p) => p.id === build.projectId)

  // The editor step only appears for builds that actually needed it.
  const stages = useMemo(
    () =>
      build.phase === 'closing-editor' || build.closedEditor
        ? (['closing-editor', ...BASE_STAGES] as BuildPhaseId[])
        : BASE_STAGES,
    [build.phase, build.closedEditor]
  )

  return (
    <>
      <div className="shrink-0 border-b border-line px-3 pb-2 pt-2.5">
        <div className="flex items-center gap-2">
          <StatusIcon build={build} size={13} />
          <span className="truncate text-base font-medium text-fg">
            {build.profileName ?? build.target ?? 'Build'}
          </span>
          {build.profileName && <span className="chip">profile</span>}
          {build.version && <span className="chip">v{build.version}</span>}
          {build.development && (
            <span className="chip border-warn/30 bg-warn/10 text-warn">development</span>
          )}
          <span className="text-sm tabular-nums text-fg-faint">{duration(elapsed)}</span>

          <div className="ml-auto flex items-center gap-1">
            {build.running ? (
              <button
                onClick={() => stopBuild(build.projectId)}
                className="btn-secondary hover:text-danger"
              >
                <Square size={11} fill="currentColor" /> Stop build
              </button>
            ) : (
              <>
                {project && (
                  <button
                    onClick={() =>
                      startBuild(project, {
                        target: build.target,
                        development: build.development,
                        outputPath: build.outputPath
                      })
                    }
                    className="btn-secondary"
                  >
                    <RotateCw size={12} /> Rebuild
                  </button>
                )}
                {(build.outputPath || build.report?.outputPath) && (
                  <button onClick={() => revealBuild(build.id)} className="btn-secondary">
                    <FolderOpen size={13} /> Output
                  </button>
                )}
                <button
                  onClick={() => forgetBuild(build.id)}
                  className="icon-btn"
                  title="Remove from history"
                >
                  <Trash2 size={13} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Phase stepper + what the engine is doing right now */}
        <div className="mt-2.5 flex items-center gap-1.5">
          {stages.map((stage) => {
            const reached =
              stages.indexOf(build.phase as BuildPhaseId) >= stages.indexOf(stage) ||
              build.phase === 'succeeded'
            return (
              <div key={stage} className="flex-1" title={PHASE_LABEL[stage]}>
                <div
                  className={`h-[3px] rounded-full transition-colors ${
                    build.phase === stage && build.running
                      ? 'animate-pulse bg-accent'
                      : reached
                        ? build.phase === 'failed'
                          ? 'bg-danger/60'
                          : 'bg-ok/60'
                        : 'bg-line-strong'
                  }`}
                />
                <div className="mt-1 truncate text-2xs text-fg-faint">{PHASE_LABEL[stage]}</div>
              </div>
            )
          })}
        </div>

        <div className="mt-1.5 flex items-center gap-3 text-xs">
          <span className="min-w-0 flex-1 truncate text-fg-muted" title={build.activity}>
            {build.running ? (build.activity ?? 'Working…') : PHASE_LABEL[build.phase]}
            {build.message && !build.running ? ` — ${build.message}` : ''}
          </span>
          {build.closedEditor && (
            <span className="shrink-0 text-fg-faint">editor closed for this build</span>
          )}
          {build.imported ? (
            <span className="shrink-0 tabular-nums text-fg-faint">
              {build.imported} assets imported
            </span>
          ) : null}
          {build.errorCount ? (
            <span className="shrink-0 tabular-nums text-danger">{build.errorCount} errors</span>
          ) : null}
          {build.warnCount ? (
            <span className="shrink-0 tabular-nums text-warn">{build.warnCount} warnings</span>
          ) : null}
          {build.report?.totalBytes ? (
            <span className="shrink-0 tabular-nums text-fg-muted">
              {bytes(build.report.totalBytes)}
            </span>
          ) : null}
          {build.running && (
            <span className="shrink-0 tabular-nums text-fg-faint">{build.percent}%</span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 border-b border-line px-3">
        {(['log', 'report', 'project', 'build', 'cleanup', 'publish'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b py-2 text-base font-medium transition-colors ${
              tab === t
                ? 'border-fg text-fg'
                : 'border-transparent text-fg-subtle hover:text-fg-muted'
            }`}
          >
            {
              {
                log: 'Log',
                report: 'Report',
                project: 'Project assets',
                build: 'Build assets',
                cleanup: 'Cleanup',
                publish: 'Publish'
              }[t]
            }
          </button>
        ))}
      </div>

      {tab === 'log' && <LogViewer key={build.id} lines={build.lines} />}
      {tab === 'report' && <BuildReportPanel build={build} />}
      {tab === 'build' && <BuildAssetsPanel build={build} />}
      {tab === 'project' && project && <AssetAnalysisPanel project={project} />}
      {tab === 'cleanup' && project && <CleanupPanel project={project} build={build} />}
      {tab === 'publish' && project && <PublishPanel project={project} build={build} />}
      {(tab === 'project' || tab === 'cleanup' || tab === 'publish') && !project && (
        <div className="flex flex-1 items-center justify-center text-base text-fg-subtle">
          That project is no longer in your library.
        </div>
      )}
    </>
  )
}
