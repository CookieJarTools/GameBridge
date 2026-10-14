import { useEffect, useRef, useState } from 'react'
import { X, FolderOpen, Loader2, Sparkles } from 'lucide-react'
import type { CreateProjectRequest } from '@shared/types'
import { useStore } from '../store'
import { useEngines } from '../lib/engine'

export function NewProjectModal({ onClose }: { onClose: () => void }): JSX.Element {
  const engines = useEngines()
  const unityEditors = useStore((s) => s.settings?.engineConfig.unityEditors ?? [])
  const refreshData = useStore((s) => s.refreshData)
  const setView = useStore((s) => s.setView)
  const toast = useStore((s) => s.toast)

  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [engineId, setEngineId] = useState(engines[0]?.id ?? '')
  const [version, setVersion] = useState(unityEditors[0]?.version ?? '')
  const [opts, setOpts] = useState({
    initGit: true,
    gitignore: true,
    gitattributes: true,
    readme: true,
    initialCommit: true
  })

  const [creating, setCreating] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const logEnd = useRef<HTMLDivElement>(null)

  const engine = engines.find((e) => e.id === engineId)
  const isUnity = engine?.kind === 'unity'

  useEffect(() => {
    const off = window.gamebridge.onInstallLog((e) => {
      if (e.key === 'create-project') setLog((l) => [...l, e.line])
    })
    return off
  }, [])
  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'end' })
  }, [log.length])

  const pickLocation = async (): Promise<void> => {
    const dir = await window.gamebridge.pickFolder()
    if (dir) setLocation(dir)
  }

  const create = async (): Promise<void> => {
    setCreating(true)
    setLog([])
    const req: CreateProjectRequest = {
      name,
      location,
      engineId,
      engineVersion: isUnity ? version || undefined : undefined,
      ...opts
    }
    const res = await window.gamebridge.createProject(req)
    setCreating(false)
    if (res.ok) {
      await refreshData()
      toast(res.message)
      setView('library')
      onClose()
    } else {
      toast(res.message, 'error')
    }
  }

  const canCreate = name.trim() && location && engineId && !creating

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 ">
      <div className="w-[560px] max-h-[88vh] flex flex-col rounded-lg bg-bg-panel border border-line shadow-popover">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-accent" />
            <h2 className="text-md font-medium tracking-tight text-fg">New project</h2>
          </div>
          <button onClick={onClose} className="text-fg-subtle hover:text-fg">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Awesome Game"
              className="input"
              autoFocus
              disabled={creating}
            />
          </Field>

          <Field label="Location (parent folder)">
            <div className="flex gap-2">
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="F:\Dev"
                className="input"
                disabled={creating}
              />
              <button onClick={pickLocation} disabled={creating} className="btn-secondary shrink-0">
                <FolderOpen size={15} /> Browse
              </button>
            </div>
            {name.trim() && location && (
              <p className="mt-1 text-[11px] text-fg-subtle break-all">
                Creates: {location}\{name.trim()}
              </p>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Engine">
              <select
                value={engineId}
                onChange={(e) => setEngineId(e.target.value)}
                className="input"
                disabled={creating}
              >
                {engines.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </Field>
            {isUnity && (
              <Field label="Unity version">
                <select
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  className="input"
                  disabled={creating}
                >
                  {unityEditors.length === 0 && <option value="">no editors installed</option>}
                  {unityEditors.map((ed) => (
                    <option key={ed.version} value={ed.version}>
                      {ed.version}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>

          {engine && engine.kind === 'unreal' && (
            <p className="text-[11px] text-warn/80 bg-warn/10 border border-warn/30 rounded-lg px-3 py-2">
              Unreal has no project-creation CLI — GameBridge will scaffold the folder + git, but
              you'll create the .uproject from the Unreal Editor, then re-scan.
            </p>
          )}

          <div>
            <span className="block mb-2 text-xs font-medium text-fg-muted">Set up</span>
            <div className="grid grid-cols-2 gap-2">
              <Check label="Init git repo" v={opts.initGit} on={(b) => setOpts({ ...opts, initGit: b })} d={creating} />
              <Check label=".gitignore" v={opts.gitignore} on={(b) => setOpts({ ...opts, gitignore: b })} d={creating} />
              <Check label=".gitattributes (LFS)" v={opts.gitattributes} on={(b) => setOpts({ ...opts, gitattributes: b })} d={creating} />
              <Check label="README.md" v={opts.readme} on={(b) => setOpts({ ...opts, readme: b })} d={creating} />
              <Check
                label="Initial commit"
                v={opts.initialCommit && opts.initGit}
                on={(b) => setOpts({ ...opts, initialCommit: b })}
                d={creating || !opts.initGit}
              />
            </div>
          </div>

          {log.length > 0 && (
            <pre className="max-h-40 overflow-y-auto rounded-lg bg-[#0a0b0e] border border-line p-2 text-[10.5px] leading-snug font-mono text-fg-muted whitespace-pre-wrap break-all">
              {log.join('\n')}
              <div ref={logEnd} />
            </pre>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          {creating && (
            <span className="flex items-center gap-2 text-xs text-fg-muted">
              <Loader2 size={14} className="animate-spin" /> Creating…
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <button
              onClick={onClose}
              disabled={creating}
              className="btn-ghost"
            >
              Cancel
            </button>
            <button
              onClick={create}
              disabled={!canCreate}
              className="btn-primary"
            >
              Create project
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block">
      <span className="block mb-1.5 text-xs font-medium text-fg-muted">{label}</span>
      {children}
    </label>
  )
}

function Check({
  label,
  v,
  on,
  d
}: {
  label: string
  v: boolean
  on: (b: boolean) => void
  d?: boolean
}): JSX.Element {
  return (
    <label className={`flex items-center gap-2 ${d ? 'opacity-50' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={v}
        disabled={d}
        onChange={(e) => on(e.target.checked)}
        className="h-3.5 w-3.5 accent-[#6d8bff]"
      />
      <span className="text-xs text-fg-muted">{label}</span>
    </label>
  )
}
