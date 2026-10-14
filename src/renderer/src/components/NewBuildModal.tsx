import { useEffect, useMemo, useState } from 'react'
import { Hammer, X } from 'lucide-react'
import type { ProjectVersion, UnityBuildProfile } from '@shared/types'
import { UNITY_BUILD_TARGETS, defaultBuildTarget } from '@shared/buildtargets'
import { findEngine } from '@shared/engines'
import { useStore } from '../store'

/**
 * Target/output picker for a headless build. Unity gets the full platform list;
 * other engines just run their configured build command.
 */
export function NewBuildModal({
  projectId,
  onClose
}: {
  projectId?: string
  onClose: () => void
}): JSX.Element {
  const projects = useStore((s) => s.projects)
  const settings = useStore((s) => s.settings)
  const startBuild = useStore((s) => s.startBuild)
  const builds = useStore((s) => s.builds)
  const buildByProject = useStore((s) => s.buildByProject)

  const buildable = useMemo(() => projects.filter((p) => p.engineId), [projects])
  const [selected, setSelected] = useState(projectId ?? buildable[0]?.id ?? '')
  const project = buildable.find((p) => p.id === selected)
  const engine = settings && project ? findEngine(settings.engines, project.engineId) : undefined
  const isUnity = engine?.kind === 'unity'

  const [target, setTarget] = useState(defaultBuildTarget(navigator.platform.toLowerCase().includes('mac') ? 'darwin' : 'win32').id)
  const [development, setDevelopment] = useState(false)
  const [output, setOutput] = useState('')
  const [touchedOutput, setTouchedOutput] = useState(false)
  const [profiles, setProfiles] = useState<UnityBuildProfile[]>([])
  const [profilePath, setProfilePath] = useState('')
  const [profileState, setProfileState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [version, setVersion] = useState<(ProjectVersion & { next?: string }) | null>(null)

  // What this build will be stamped with, after the project's bump is applied.
  useEffect(() => {
    setVersion(null)
    if (!project || !isUnity) return
    let live = true
    window.gamebridge
      .versionRead(project.id)
      .then((v) => live && setVersion(v))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [project, isUnity])

  // Unity 6 Build Profiles, read straight out of the project's .asset files.
  useEffect(() => {
    setProfiles([])
    setProfilePath('')
    if (!project || !isUnity) return
    let live = true
    setProfileState('loading')
    window.gamebridge
      .buildProfiles(project.id)
      .then((found) => {
        if (!live) return
        setProfiles(found)
        setProfileState('ready')
      })
      // An older running copy of the app has no handler for this yet; say so
      // rather than showing an empty picker with no explanation.
      .catch(() => live && setProfileState('failed'))
    return () => {
      live = false
    }
  }, [project, isUnity])

  const profile = profiles.find((p) => p.path === profilePath)

  /*
   * The output box stays empty unless you type in it. Builds now go into their
   * own numbered folder, which the main process works out at build time from
   * what is already on disk — suggesting a fixed path here would mean every
   * build overwrote the same folder. Typing a path overrides that entirely.
   */
  useEffect(() => {
    if (touchedOutput) return
    setOutput('')
  }, [project, target, profile, touchedOutput])

  const activeBuild = project ? builds[buildByProject[project.id] ?? '']?.running : false

  const submit = (): void => {
    if (!project || activeBuild) return
    startBuild(
      project,
      isUnity
        ? { target, development, outputPath: output, profilePath: profilePath || undefined }
        : {}
    )
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[460px] rounded-lg border border-line bg-bg-panel shadow-popover"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Hammer size={14} className="text-accent" />
          <h2 className="text-md font-medium tracking-tight text-fg">New build</h2>
          <button onClick={onClose} className="btn-icon ml-auto">
            <X size={15} />
          </button>
        </div>

        <div className="space-y-3.5 p-4">
          <div>
            <label className="mb-1.5 block text-sm text-fg-muted">Project</label>
            <select
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value)
                setTouchedOutput(false)
              }}
              className="input"
            >
              {buildable.length === 0 && <option value="">No projects with an engine assigned</option>}
              {buildable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {isUnity ? (
            <>
              {/*
                Always shown for Unity, even with nothing to pick — hiding it
                made the feature look missing rather than empty.
              */}
              <div>
                <label className="mb-1.5 block text-sm text-fg-muted">Build profile</label>
                <select
                  value={profilePath}
                  disabled={profiles.length === 0}
                  onChange={(e) => {
                    setProfilePath(e.target.value)
                    setTouchedOutput(false)
                  }}
                  className="input disabled:cursor-not-allowed disabled:text-fg-faint"
                >
                  <option value="">
                    {profiles.length === 0
                      ? 'No build profiles in this project'
                      : 'None — use Build Settings'}
                  </option>
                  {profiles.map((p) => (
                    <option key={p.path} value={p.path}>
                      {p.name}
                      {p.platform ? ` · ${p.platform}` : ''}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-fg-faint">
                  {profileState === 'loading'
                    ? 'Looking for build profiles…'
                    : profileState === 'failed'
                      ? 'Could not look for build profiles — restart GameBridge and try again.'
                      : profile
                        ? 'The profile decides the platform, scenes and player settings for this build.'
                        : profiles.length > 0
                          ? `${profiles.length} profile${profiles.length === 1 ? '' : 's'} found in this project.`
                          : 'Unity 6 profiles live in the project as assets — create them in the editor under File → Build Profiles, then they show up here.'}
                </p>
              </div>

              {!profile && (
                <div>
                  <label className="mb-1.5 block text-sm text-fg-muted">Platform</label>
                  <select
                    value={target}
                    onChange={(e) => {
                      setTarget(e.target.value)
                      setTouchedOutput(false)
                    }}
                    className="input"
                  >
                    {UNITY_BUILD_TARGETS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-xs text-fg-faint">
                    The matching editor module has to be installed, and switching platform makes
                    Unity reimport assets — the first build for a new platform is slow.
                  </p>
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-sm text-fg-muted">
                  Output <span className="text-fg-faint">(leave blank for the next numbered folder)</span>
                </label>
                <input
                  value={output}
                  onChange={(e) => {
                    setOutput(e.target.value)
                    setTouchedOutput(true)
                  }}
                  spellCheck={false}
                  className="input font-mono text-xs"
                />
              </div>

              <label className="flex items-center gap-2 text-base text-fg-muted">
                <input
                  type="checkbox"
                  checked={development}
                  onChange={(e) => setDevelopment(e.target.checked)}
                  className="accent-accent"
                />
                Development build (profiler + script debugging)
              </label>

              {version && (
                <div className="rounded-md border border-line bg-bg-soft px-2.5 py-2">
                  <div className="flex items-center gap-2 text-base">
                    <span className="text-fg-muted">Version</span>
                    <span className="tabular-nums text-fg">{version.version}</span>
                    {version.next && version.next !== version.version && (
                      <>
                        <span className="text-fg-faint">→</span>
                        <span className="tabular-nums text-accent">{version.next}</span>
                      </>
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-fg-faint">
                    {version.next && version.next !== version.version
                      ? 'The project version is bumped before this build runs, and the build folder is named after it. Change what gets bumped in this project\u2019s settings.'
                      : 'This project doesn\u2019t bump its version automatically. Turn it on in the project\u2019s settings if you want each build numbered.'}
                  </p>
                </div>
              )}

              <p className="text-xs leading-relaxed text-fg-faint">
                GameBridge writes a temporary editor script into the project, builds with it, then
                deletes it. Unity can&apos;t have the project open at the same time. Each build goes
                into its own numbered folder under Builds.
              </p>
            </>
          ) : (
            <p className="text-base leading-relaxed text-fg-muted">
              {engine
                ? `${engine.name} builds run the command configured in Settings → Engines. Platform and output options are Unity-only.`
                : 'Assign an engine to this project first.'}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-1.5 border-t border-line px-4 py-3">
          <button onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button onClick={submit} disabled={!project || activeBuild} className="btn-primary">
            <Hammer size={13} />
            {activeBuild ? 'Already building' : 'Start build'}
          </button>
        </div>
      </div>
    </div>
  )
}
