import { useState } from 'react'
import { Plus, Rocket, Trash2, X } from 'lucide-react'
import type { Project, PublishKind, PublishTarget } from '@shared/types'
import { useStore } from '../store'
import { IS_WINDOWS } from '../lib/platform'

const KIND_LABEL: Record<PublishKind, string> = {
  steam: 'Steam',
  itch: 'itch.io',
  custom: 'Custom command'
}

const BLANK: Record<PublishKind, Partial<PublishTarget>> = {
  steam: { name: 'Steam', branch: '', description: '' },
  itch: { name: 'itch.io', itchTarget: '' },
  custom: { name: 'Custom', command: '' }
}

/** Where a project's builds can be sent. No secret is ever kept here. */
export function PublishTargetsModal({
  project,
  onClose
}: {
  project: Project
  onClose: () => void
}): JSX.Element {
  const updateProject = useStore((s) => s.updateProject)
  const [targets, setTargets] = useState<PublishTarget[]>(project.publishTargets ?? [])
  const [selectedId, setSelectedId] = useState(targets[0]?.id ?? '')

  const selected = targets.find((t) => t.id === selectedId)

  const commit = async (next: PublishTarget[]): Promise<void> => {
    setTargets(next)
    await updateProject(project.id, { publishTargets: next })
  }

  const add = (kind: PublishKind): void => {
    const target: PublishTarget = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind,
      name: BLANK[kind].name ?? KIND_LABEL[kind],
      ...BLANK[kind]
    } as PublishTarget
    void commit([...targets, target])
    setSelectedId(target.id)
  }

  const patch = (changes: Partial<PublishTarget>): void => {
    if (!selected) return
    void commit(targets.map((t) => (t.id === selected.id ? { ...t, ...changes } : t)))
  }

  const remove = (id: string): void => {
    const next = targets.filter((t) => t.id !== id)
    void commit(next)
    if (selectedId === id) setSelectedId(next[0]?.id ?? '')
  }

  const pickTool = async (): Promise<void> => {
    const exe = await window.gamebridge.pickExecutable()
    if (exe) patch({ toolPath: exe })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="flex h-[520px] w-full max-w-[720px] flex-col rounded-lg border border-line bg-bg-panel shadow-popover">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Rocket size={14} className="text-accent" />
          <h2 className="text-md font-medium tracking-tight text-fg">
            Publish targets — {project.name}
          </h2>
          <button onClick={onClose} className="btn-icon ml-auto">
            <X size={15} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Target list */}
          <div className="flex w-[220px] shrink-0 flex-col border-r border-line">
            <div className="flex-1 space-y-px overflow-y-auto p-2">
              {targets.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={`row items-start ${selectedId === t.id ? 'row-selected' : ''}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{t.name}</span>
                    <span className="block truncate text-2xs text-fg-faint">
                      {KIND_LABEL[t.kind]}
                    </span>
                  </span>
                </button>
              ))}
              {targets.length === 0 && (
                <p className="px-2 py-3 text-xs leading-relaxed text-fg-subtle">
                  Nothing here yet. Add a target below.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-1 border-t border-line p-2">
              {(Object.keys(KIND_LABEL) as PublishKind[]).map((k) => (
                <button key={k} onClick={() => add(k)} className="btn-secondary h-6 text-sm">
                  <Plus size={11} /> {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          </div>

          {/* Target form */}
          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            {!selected ? (
              <p className="pt-10 text-center text-base text-fg-muted">
                Pick a target to edit, or add one.
              </p>
            ) : (
              <div className="space-y-3.5">
                <Row label="Name">
                  <input
                    value={selected.name}
                    onChange={(e) => patch({ name: e.target.value })}
                    className="input"
                  />
                </Row>

                {selected.kind !== 'custom' && (
                  <Row
                    label={selected.kind === 'steam' ? 'steamcmd' : 'butler'}
                    hint={
                      selected.kind === 'steam'
                        ? `From the Steamworks SDK, usually ${IS_WINDOWS ? 'tools/ContentBuilder/builder/steamcmd.exe' : 'tools/ContentBuilder/builder_linux/steamcmd.sh'}.`
                        : 'The itch.io upload tool. Install it once and point here.'
                    }
                  >
                    <div className="flex gap-1.5">
                      <input
                        value={selected.toolPath ?? ''}
                        onChange={(e) => patch({ toolPath: e.target.value })}
                        placeholder="Path to the tool"
                        spellCheck={false}
                        className="input font-mono text-xs"
                      />
                      <button onClick={pickTool} className="btn-secondary shrink-0">
                        Browse
                      </button>
                    </div>
                  </Row>
                )}

                {selected.kind === 'steam' && (
                  <>
                    <Row label="App ID">
                      <input
                        value={selected.appId ?? ''}
                        onChange={(e) => patch({ appId: e.target.value })}
                        placeholder="480"
                        className="input tabular-nums"
                      />
                    </Row>
                    <Row label="Depot ID">
                      <input
                        value={selected.depotId ?? ''}
                        onChange={(e) => patch({ depotId: e.target.value })}
                        placeholder="481"
                        className="input tabular-nums"
                      />
                    </Row>
                    <Row
                      label="Username"
                      hint="Only the name. Log in once with steamcmd in a terminal so it caches the rest — GameBridge never sees your password."
                    >
                      <input
                        value={selected.username ?? ''}
                        onChange={(e) => patch({ username: e.target.value })}
                        autoComplete="off"
                        className="input"
                      />
                    </Row>
                    <Row
                      label="Set live on"
                      hint="A branch name like beta, or blank to upload without making it live."
                    >
                      <input
                        value={selected.branch ?? ''}
                        onChange={(e) => patch({ branch: e.target.value })}
                        placeholder="(none)"
                        className="input"
                      />
                      {selected.branch?.trim().toLowerCase() === 'default' && (
                        <p className="mt-1.5 text-xs leading-relaxed text-warn">
                          Steam will not let steamcmd set the default branch live — the upload fails
                          with &ldquo;Access Denied&rdquo;. Leave this blank and set the build live
                          in Steamworks instead.
                        </p>
                      )}
                    </Row>
                    <Row label="Description">
                      <input
                        value={selected.description ?? ''}
                        onChange={(e) => patch({ description: e.target.value })}
                        placeholder="Shown in Steamworks next to the build"
                        className="input"
                      />
                    </Row>
                  </>
                )}

                {selected.kind === 'itch' && (
                  <Row label="Destination" hint="In the form user/game:channel.">
                    <input
                      value={selected.itchTarget ?? ''}
                      onChange={(e) => patch({ itchTarget: e.target.value })}
                      placeholder="studio/my-game:windows"
                      spellCheck={false}
                      className="input font-mono text-xs"
                    />
                  </Row>
                )}

                {selected.kind === 'custom' && (
                  <Row
                    label="Command"
                    hint="Tokens: {output} {outputDir} {version} {name} {target} {profile}"
                  >
                    <textarea
                      value={selected.command ?? ''}
                      onChange={(e) => patch({ command: e.target.value })}
                      rows={3}
                      spellCheck={false}
                      placeholder='rclone copy "{outputDir}" remote:builds/{version}'
                      className="input font-mono text-xs"
                    />
                  </Row>
                )}

                <label className="flex items-center gap-2 text-base text-fg-muted">
                  <input
                    type="checkbox"
                    checked={!!selected.dryRun}
                    onChange={(e) => patch({ dryRun: e.target.checked })}
                    className="accent-accent"
                  />
                  Dry run — check the upload without publishing it
                </label>

                <div className="border-t border-line pt-3">
                  <button onClick={() => remove(selected.id)} className="btn-danger">
                    <Trash2 size={13} /> Delete this target
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end border-t border-line px-4 py-3">
          <button onClick={onClose} className="btn-primary">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div>
      <label className="mb-1.5 block text-sm text-fg-muted">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs leading-relaxed text-fg-faint">{hint}</p>}
    </div>
  )
}
