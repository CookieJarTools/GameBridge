import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Hammer, Plus } from 'lucide-react'
import { useStore, type BuildUi, type InstanceRef, type RunUi } from '../store'
import { NewBuildModal } from './NewBuildModal'
import { EditorBusyModal } from './EditorBusyModal'
import { RunDetail } from './RunDetail'
import { BuildDetail } from './BuildDetail'
import { RunIcon, StatusIcon } from './InstanceIcons'

type Section = 'builds' | 'logs'

interface ProjectTab {
  projectId: string
  name: string
  /** Newest first. */
  builds: BuildUi[]
  run?: RunUi
  busy: boolean
  /** The project is still in the library, so it can be rebuilt. */
  known: boolean
}

/**
 * A tab per project. Inside one, switch between that project's builds and its
 * captured output; builds get their own list so history stays browsable.
 */
export function InstancesView(): JSX.Element {
  const runs = useStore((s) => s.runs)
  const builds = useStore((s) => s.builds)
  const buildOrder = useStore((s) => s.buildOrder)
  const projects = useStore((s) => s.projects)
  const selectedInstance = useStore((s) => s.selectedInstance)
  const selectInstance = useStore((s) => s.selectInstance)
  const loadBuilds = useStore((s) => s.loadBuilds)
  const startBuild = useStore((s) => s.startBuild)

  const [newBuildFor, setNewBuildFor] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const tabStripRef = useRef<HTMLDivElement>(null)

  /** What was last looked at per project, so switching tabs comes back to it. */
  const lastSeen = useRef<Record<string, InstanceRef>>({})

  useEffect(() => {
    loadBuilds()
  }, [loadBuilds])

  const tabs = useMemo<ProjectTab[]>(() => {
    const ids = new Set<string>([
      ...Object.keys(runs),
      ...buildOrder.map((id) => builds[id]?.projectId).filter((x): x is string => !!x)
    ])

    return [...ids]
      .map((projectId) => {
        const projectBuilds = buildOrder
          .map((id) => builds[id])
          .filter((b) => b && b.projectId === projectId)
        const run = runs[projectId]
        return {
          projectId,
          name:
            projects.find((p) => p.id === projectId)?.name ??
            projectBuilds[0]?.projectName ??
            'Unknown project',
          builds: projectBuilds,
          run,
          busy: !!run?.running || projectBuilds.some((b) => b.running),
          known: projects.some((p) => p.id === projectId)
        }
      })
      // Alphabetical, so tabs never reshuffle under the cursor; busy shows as a dot.
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [runs, builds, buildOrder, projects])

  /* The selected instance decides both the active tab and the active section. */
  const selected = useMemo(() => {
    if (!selectedInstance) return null
    if (selectedInstance.kind === 'run') {
      return runs[selectedInstance.id] ? selectedInstance : null
    }
    return builds[selectedInstance.id] ? selectedInstance : null
  }, [selectedInstance, runs, builds])

  const activeTab =
    (selected &&
      tabs.find((t) =>
        selected.kind === 'run'
          ? t.projectId === selected.id
          : t.projectId === builds[selected.id]?.projectId
      )) ??
    tabs[0] ??
    null

  /**
   * The selected instance normally decides the section, but a section with
   * nothing in it has nothing to select — so the click can override, and the
   * next selection change puts the two back in step.
   */
  const [section, setSection] = useState<Section>('builds')
  useEffect(() => {
    if (selected) setSection(selected.kind === 'run' ? 'logs' : 'builds')
  }, [selected])

  // Remember where we were, and keep the active tab on screen when it changes.
  useEffect(() => {
    if (activeTab && selected) lastSeen.current[activeTab.projectId] = selected
  }, [activeTab, selected])

  useEffect(() => {
    tabStripRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTab?.projectId])

  const openNewBuild = (projectId?: string): void => {
    setNewBuildFor(projectId ?? null)
    setNewOpen(true)
  }

  /** Open a project tab where it was last left, else at whatever it has. */
  const openTab = (tab: ProjectTab): void => {
    const remembered = lastSeen.current[tab.projectId]
    const stillThere =
      remembered && (remembered.kind === 'run' ? !!runs[remembered.id] : !!builds[remembered.id])
    if (remembered && stillThere) {
      selectInstance(remembered)
      return
    }
    if (tab.builds.length) selectInstance({ kind: 'build', id: tab.builds[0].id })
    else if (tab.run) selectInstance({ kind: 'run', id: tab.projectId })
  }

  /** Switch section, selecting something in it when there is anything to select. */
  const showSection = (tab: ProjectTab, want: Section): void => {
    setSection(want)
    if (want === 'logs' && tab.run) selectInstance({ kind: 'run', id: tab.projectId })
    else if (want === 'builds' && tab.builds.length) {
      selectInstance({ kind: 'build', id: tab.builds[0].id })
    }
  }

  if (tabs.length === 0) {
    return (
      <>
        <div className="flex h-full flex-col items-center justify-center text-center">
          <Activity size={36} className="mb-3 text-fg-faint" />
          <h3 className="text-md font-medium text-fg">Nothing running yet</h3>
          <p className="mt-1 max-w-md text-base text-fg-muted">
            Each project gets a tab here once it has a build or captured output. Start a build
            below, or turn on <span className="text-fg">Console</span> for an engine (Settings →
            Engines) and launch a project to watch its log.
          </p>
          <button onClick={() => openNewBuild()} className="btn-primary mt-4">
            <Plus size={14} /> New build
          </button>
        </div>
        {newOpen && (
          <NewBuildModal projectId={newBuildFor ?? undefined} onClose={() => setNewOpen(false)} />
        )}
        <EditorBusyModal />
      </>
    )
  }

  const activeBuild =
    section === 'builds' && selected?.kind === 'build' ? builds[selected.id] : undefined

  return (
    <div className="flex h-full flex-col">
      {/* Project tabs */}
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line pl-2 pr-2">
        <div ref={tabStripRef} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = tab.projectId === activeTab?.projectId
            return (
              <button
                key={tab.projectId}
                data-active={isActive}
                onClick={() => openTab(tab)}
                className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-base transition-colors ${
                  isActive
                    ? 'bg-bg-active font-medium text-fg'
                    : 'text-fg-muted hover:bg-bg-hover hover:text-fg'
                }`}
              >
                {tab.busy && <span className="h-1.5 w-1.5 rounded-full bg-ok" />}
                <span className="max-w-[160px] truncate">{tab.name}</span>
              </button>
            )
          })}
        </div>

        <button
          onClick={() => openNewBuild(activeTab?.known ? activeTab.projectId : undefined)}
          className="btn-secondary shrink-0"
          title="New build"
        >
          <Plus size={14} /> New build
        </button>
      </div>

      {activeTab && (
        <>
          {/* Builds / Logs */}
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
            <div className="flex rounded-md border border-line bg-bg-soft p-0.5">
              <button
                onClick={() => showSection(activeTab, 'builds')}
                className={`flex h-5 items-center gap-1.5 rounded px-2 text-sm transition-colors ${
                  section === 'builds' ? 'bg-bg-active text-fg' : 'text-fg-subtle hover:text-fg-muted'
                }`}
              >
                Builds
                {activeTab.builds.length > 0 && (
                  <span className="tabular-nums text-fg-faint">{activeTab.builds.length}</span>
                )}
              </button>
              <button
                onClick={() => showSection(activeTab, 'logs')}
                className={`flex h-5 items-center gap-1.5 rounded px-2 text-sm transition-colors ${
                  section === 'logs' ? 'bg-bg-active text-fg' : 'text-fg-subtle hover:text-fg-muted'
                }`}
              >
                Logs
                {activeTab.run && <RunIcon run={activeTab.run} size={9} />}
              </button>
            </div>

            {activeTab.known && (
              <button
                onClick={() => {
                  const project = projects.find((p) => p.id === activeTab.projectId)
                  if (project) startBuild(project)
                }}
                className="btn-ghost ml-auto"
                title={`Build ${activeTab.name} with the last settings`}
              >
                <Hammer size={13} /> Build
              </button>
            )}
          </div>

          {/* Section body */}
          {section === 'logs' ? (
            activeTab.run ? (
              <RunDetail projectId={activeTab.projectId} run={activeTab.run} />
            ) : (
              <Empty
                title="No captured output for this project"
                detail="Turn on Console for its engine in Settings → Engines, then launch it. Unity and Unreal stream their editor log; custom games stream stdout and stderr."
              />
            )
          ) : activeTab.builds.length === 0 ? (
            <Empty
              title="No builds for this project yet"
              detail="Start one from the New build button above — GameBridge drives the engine headlessly and keeps the report."
            />
          ) : (
            <div className="flex min-h-0 flex-1">
              {/* This project's builds */}
              <div className="w-[196px] shrink-0 space-y-px overflow-y-auto border-r border-line bg-bg-soft p-2">
                {activeTab.builds.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => selectInstance({ kind: 'build', id: b.id })}
                    className={`row items-start ${activeBuild?.id === b.id ? 'row-selected' : ''}`}
                  >
                    <span className="mt-[3px]">
                      <StatusIcon build={b} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{b.target ?? 'Build'}</span>
                      <span className="block truncate text-2xs text-fg-faint">
                        {b.development ? 'dev · ' : ''}
                        {new Date(b.startedAt).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </span>
                  </button>
                ))}
              </div>

              <div className="flex min-w-0 flex-1 flex-col">
                {activeBuild && <BuildDetail build={activeBuild} />}
              </div>
            </div>
          )}
        </>
      )}

      {newOpen && (
        <NewBuildModal projectId={newBuildFor ?? undefined} onClose={() => setNewOpen(false)} />
      )}
      <EditorBusyModal />
    </div>
  )
}

function Empty({ title, detail }: { title: string; detail: string }): JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <h3 className="text-md font-medium text-fg">{title}</h3>
      <p className="mt-1 max-w-md text-base text-fg-muted">{detail}</p>
    </div>
  )
}
