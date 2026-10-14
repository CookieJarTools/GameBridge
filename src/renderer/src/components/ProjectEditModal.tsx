import { useMemo, useState } from 'react'
import { X, Trash2, Plus, ArrowUpCircle, AlertTriangle } from 'lucide-react'
import type { Project, VersionBump } from '@shared/types'
import { useStore } from '../store'
import { useEngines } from '../lib/engine'

interface Props {
  project: Project
  onClose: () => void
}

export function ProjectEditModal({ project, onClose }: Props): JSX.Element {
  const updateProject = useStore((s) => s.updateProject)
  const removeProject = useStore((s) => s.removeProject)
  const updateVersion = useStore((s) => s.updateVersion)
  const predefinedTags = useStore((s) => s.settings?.tags ?? [])
  const addGlobalTag = useStore((s) => s.addGlobalTag)
  const unityEditors = useStore((s) => s.settings?.engineConfig.unityEditors ?? [])
  const unrealInstalls = useStore((s) => s.settings?.engineConfig.unrealInstalls ?? [])
  const engines = useEngines()

  const [name, setName] = useState(project.name)
  const [engineId, setEngineId] = useState(project.engineId)
  const [tags, setTags] = useState<string[]>(project.tags)
  const [newTag, setNewTag] = useState('')
  const [buildOverride, setBuildOverride] = useState(project.buildTemplateOverride ?? '')
  const [buildArgs, setBuildArgs] = useState(project.buildArgs ?? '')
  const [versionBump, setVersionBump] = useState<VersionBump>(project.versionBump ?? 'none')
  const [keepBuilds, setKeepBuilds] = useState(String(project.keepBuilds ?? 0))

  const currentEngine = engines.find((e) => e.id === engineId)
  const versionOptions =
    currentEngine?.kind === 'unity'
      ? unityEditors.map((e) => e.version)
      : currentEngine?.kind === 'unreal'
        ? unrealInstalls.map((u) => u.version)
        : []
  const [targetVersion, setTargetVersion] = useState('')
  const [confirmUpdate, setConfirmUpdate] = useState(false)

  const doUpdate = async (): Promise<void> => {
    if (!targetVersion) return
    await updateVersion(project, targetVersion)
    onClose()
  }

  // Selectable set = predefined vocabulary plus any tags already on this project.
  const available = useMemo(
    () => Array.from(new Set([...predefinedTags, ...tags])).sort(),
    [predefinedTags, tags]
  )

  const toggleTag = (t: string): void =>
    setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))

  const addNewTag = async (): Promise<void> => {
    const t = newTag.trim()
    if (!t) return
    if (!tags.includes(t)) setTags((cur) => [...cur, t])
    await addGlobalTag(t) // also add to the predefined vocabulary
    setNewTag('')
  }

  const save = async (): Promise<void> => {
    await updateProject(project.id, {
      name: name.trim() || project.name,
      engineId,
      tags,
      buildTemplateOverride: buildOverride.trim() || undefined,
      buildArgs: buildArgs.trim() || undefined,
      versionBump,
      keepBuilds: Math.max(0, Number(keepBuilds) || 0)
    })
    onClose()
  }

  const del = async (): Promise<void> => {
    await removeProject(project.id)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 "
      onClick={onClose}
    >
      <div
        className="w-[460px] rounded-lg bg-bg-panel border border-line shadow-popover"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-md font-medium tracking-tight text-fg">Edit project</h2>
          <button onClick={onClose} className="text-fg-subtle hover:text-fg">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              autoFocus
            />
          </Field>

          <Field label="Engine">
            <select
              value={engineId}
              onChange={(e) => setEngineId(e.target.value)}
              className="input"
            >
              <option value="">— unassigned —</option>
              {engines.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.builtin ? '' : ' (custom)'}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Tags">
            {available.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {available.map((t) => {
                  const on = tags.includes(t)
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleTag(t)}
                      className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                        on
                          ? 'bg-accent/20 border-accent/60 text-fg'
                          : 'bg-bg-soft border-line text-fg-muted hover:text-fg'
                      }`}
                    >
                      {t}
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-fg-subtle mb-2">
                No tags defined yet. Add them in Settings → Tags, or create one below.
              </p>
            )}
            <div className="flex gap-2">
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addNewTag()
                  }
                }}
                placeholder="Create a new tag…"
                className="input"
              />
              <button
                type="button"
                onClick={addNewTag}
                className="btn-secondary"
              >
                <Plus size={15} /> Add
              </button>
            </div>
          </Field>

          <Field label="Build args (fills {args})">
            <input
              value={buildArgs}
              onChange={(e) => setBuildArgs(e.target.value)}
              placeholder="e.g. -DfeatureX=1 --config Shipping"
              className="input font-mono text-xs"
            />
          </Field>

          <Field
            label="Version bump on each build"
            hint="Applied to the project's version before the build runs, and used to name the build folder."
          >
            <select
              value={versionBump}
              onChange={(e) => setVersionBump(e.target.value as VersionBump)}
              className="input"
            >
              <option value="none">Leave the version alone</option>
              <option value="build">Bump the last number (1.2.3 → 1.2.4)</option>
              <option value="minor">Bump minor (1.2.3 → 1.3.0)</option>
              <option value="major">Bump major (1.2.3 → 2.0.0)</option>
            </select>
          </Field>

          <Field
            label="Build folders to keep"
            hint="Each build goes into its own numbered folder. 0 keeps every one of them; anything higher deletes the oldest after a successful build."
          >
            <input
              type="number"
              min={0}
              value={keepBuilds}
              onChange={(e) => setKeepBuilds(e.target.value)}
              className="input tabular-nums"
            />
          </Field>

          <Field label="Build command override (optional)">
            <input
              value={buildOverride}
              onChange={(e) => setBuildOverride(e.target.value)}
              placeholder="Leave blank to use the engine's build command"
              className="input font-mono text-xs"
            />
          </Field>

          {versionOptions.length > 0 && (
            <div className="rounded-lg border border-line bg-bg-soft p-3">
              <span className="block mb-1.5 text-xs font-medium text-fg-muted">
                Change engine version{' '}
                <span className="text-fg-subtle">(currently {project.engineVersion ?? '—'})</span>
              </span>
              <div className="flex gap-2">
                <select
                  value={targetVersion}
                  onChange={(e) => {
                    setTargetVersion(e.target.value)
                    setConfirmUpdate(false)
                  }}
                  className="input"
                >
                  <option value="">Select a version…</option>
                  {versionOptions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                      {v === project.engineVersion ? ' (current)' : ''}
                    </option>
                  ))}
                </select>
                {!confirmUpdate ? (
                  <button
                    onClick={() => setConfirmUpdate(true)}
                    disabled={!targetVersion || targetVersion === project.engineVersion}
                    className="btn-secondary"
                  >
                    <ArrowUpCircle size={15} /> Update
                  </button>
                ) : (
                  <button
                    onClick={doUpdate}
                    className="btn bg-warn text-black hover:bg-warn/90"
                  >
                    Open &amp; migrate
                  </button>
                )}
              </div>
              {confirmUpdate && (
                <p className="mt-2 flex items-start gap-1.5 text-[11px] text-warn">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  Opening in {targetVersion} upgrades the project files — this can't be undone. Commit
                  or back up first. It'll open the editor to migrate.
                </p>
              )}
            </div>
          )}

          <p className="text-[11px] text-fg-subtle break-all">{project.path}</p>
        </div>

        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <button
            onClick={del}
            className="btn-danger"
          >
            <Trash2 size={15} /> Remove
          </button>
          <div className="ml-auto flex gap-2">
            <button
              onClick={onClose}
              className="btn-ghost"
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="btn-primary"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-fg-muted">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-relaxed text-fg-faint">{hint}</span>}
    </label>
  )
}
