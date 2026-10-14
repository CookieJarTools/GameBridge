import { useState } from 'react'
import {
  FolderPlus,
  Trash2,
  Wand2,
  Plus,
  HardDrive,
  Cpu,
  Code2,
  Boxes,
  Lock,
  Tag,
  X,
  Hammer,
  DownloadCloud
} from 'lucide-react'
import type { Engine, IDE, Settings } from '@shared/types'
import { useStore } from '../store'
import { BUILTIN_ENGINES, DEFAULT_BUILD_TEMPLATES, allEngines, nextEngineColor } from '@shared/engines'
import { UnityEditorsSection } from './UnityEditorsSection'

export function SettingsView(): JSX.Element {
  const settings = useStore((s) => s.settings)
  const saveSettings = useStore((s) => s.saveSettings)
  const load = useStore((s) => s.load)
  const toast = useStore((s) => s.toast)

  if (!settings) return <div className="p-8 text-fg-subtle">Loading…</div>

  const update = (mutator: (s: Settings) => void): void => {
    const next: Settings = structuredClone(settings)
    mutator(next)
    saveSettings(next)
  }

  const addScanRoot = async (): Promise<void> => {
    const dir = await window.gamebridge.addScanRoot()
    if (dir) {
      await load()
      toast(`Added scan root.`)
    }
  }

  const detectEngines = async (): Promise<void> => {
    await window.gamebridge.detectEngines()
    await load()
    toast('Engine detection complete.')
  }

  const detectIdes = async (): Promise<void> => {
    const ides = await window.gamebridge.detectIdes()
    await load()
    toast(ides.length ? `Detected ${ides.length} IDE(s).` : 'No IDEs auto-detected.')
  }

  const uid = (): string =>
    `${Date.now().toString(36)}-${Math.floor(performance.now()).toString(36)}`

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[680px] px-8 pb-16 pt-8">
        <h1 className="mb-1 text-xl font-semibold tracking-tight text-fg">Settings</h1>

        {/* Scan roots */}
        <Section icon={HardDrive} title="Scan roots" desc="Folders GameBridge searches for projects.">
          <div className="space-y-2">
            {settings.scanRoots.length === 0 && (
              <p className="text-sm text-fg-subtle">No scan roots yet.</p>
            )}
            {settings.scanRoots.map((r) => (
              <Row key={r}>
                <span className="text-sm text-fg-muted break-all">{r}</span>
                <button
                  onClick={() =>
                    update((s) => {
                      s.scanRoots = s.scanRoots.filter((x) => x !== r)
                    })
                  }
                  className="icon-btn"
                  title="Remove"
                >
                  <Trash2 size={15} />
                </button>
              </Row>
            ))}
          </div>
          <button onClick={addScanRoot} className="btn-secondary mt-3">
            <FolderPlus size={15} /> Add scan root
          </button>
        </Section>

        {/* Tags */}
        <Section
          icon={Tag}
          title="Tags"
          desc="Predefine tags here, then tick them on each project instead of typing."
        >
          <TagManager />
        </Section>

        {/* Engines */}
        <Section icon={Cpu} title="Editor installs" desc="Where Unity and Unreal editors live on this machine.">
          <button onClick={detectEngines} className="btn-secondary mb-3">
            <Wand2 size={14} /> Auto-detect engines
          </button>

          <label className="block mb-4">
            <span className="block mb-1.5 text-xs font-medium text-fg-muted">
              Unity editors root (Unity Hub installs folder)
            </span>
            <div className="flex gap-2">
              <input
                value={settings.engineConfig.unityEditorsRoot ?? ''}
                onChange={(e) =>
                  update((s) => {
                    s.engineConfig.unityEditorsRoot = e.target.value || undefined
                  })
                }
                placeholder="C:\Program Files\Unity\Hub\Editor"
                className="input"
              />
              <button
                onClick={async () => {
                  const dir = await window.gamebridge.pickFolder()
                  if (dir) update((s) => (s.engineConfig.unityEditorsRoot = dir))
                }}
                className="btn-secondary shrink-0"
              >
                Browse
              </button>
            </div>
          </label>

          <div>
            <span className="block mb-1.5 text-xs font-medium text-fg-muted">
              Detected Unreal installs
            </span>
            {settings.engineConfig.unrealInstalls.length === 0 ? (
              <p className="text-sm text-fg-subtle">None detected yet.</p>
            ) : (
              <div className="space-y-1.5">
                {settings.engineConfig.unrealInstalls.map((u) => (
                  <Row key={u.version}>
                    <span className="text-sm text-fg-muted">
                      UE {u.version}
                      <span className="text-fg-faint"> — {u.editorPath}</span>
                    </span>
                  </Row>
                ))}
              </div>
            )}
          </div>
        </Section>

        {/* Engines */}
        <Section
          icon={Boxes}
          title="Engines & IDEs"
          desc="Unity and Unreal are built in and can't be removed. Add your own and assign each one its IDE. Tokens: {exe} {path} {file} {args}."
        >
          <div className="mb-4 pb-4 border-b border-line">
            <IdeSelect
              label="Default IDE"
              value={settings.defaultIdeId ?? ''}
              ides={settings.ides}
              onChange={(id) => update((s) => (s.defaultIdeId = id || undefined))}
            />
            <p className="text-[11px] text-fg-subtle mt-1.5 pl-31">
              Fallback used by the split-launch button when an engine has no IDE of its own.
            </p>
          </div>

          <div className="space-y-2 mb-4">
            {BUILTIN_ENGINES.map((eng) => (
              <div
                key={eng.id}
                className="flex flex-wrap items-center gap-2.5 px-3 py-2.5 rounded-lg bg-bg-soft border border-line"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: eng.color }} />
                <span className="text-sm text-fg">{eng.name}</span>
                <span className="flex items-center gap-1 text-[11px] text-fg-subtle">
                  <Lock size={12} /> built-in
                </span>
                <div className="ml-auto flex items-center gap-3">
                  <label
                    className="flex items-center gap-1.5 cursor-pointer"
                    title="Tail the editor's log file into the Console (Unity -logFile, Unreal -abslog)."
                  >
                    <input
                      type="checkbox"
                      checked={settings.captureLogsByEngine[eng.id] ?? false}
                      onChange={(e) =>
                        update((s) => {
                          if (e.target.checked) s.captureLogsByEngine[eng.id] = true
                          else delete s.captureLogsByEngine[eng.id]
                        })
                      }
                      className="h-3.5 w-3.5 accent-[#6d8bff]"
                    />
                    <span className="text-xs text-fg-muted">Console</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-fg-muted">IDE</span>
                    <InlineIdeSelect
                      ides={settings.ides}
                      value={settings.ideByEngine[eng.id] ?? ''}
                      onChange={(id) =>
                        update((s) => {
                          if (id) s.ideByEngine[eng.id] = id
                          else delete s.ideByEngine[eng.id]
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            {settings.engines.map((eng, i) => (
              <CustomEngineEditor
                key={eng.id}
                engine={eng}
                ides={settings.ides}
                ideId={settings.ideByEngine[eng.id] ?? ''}
                captureLogs={settings.captureLogsByEngine[eng.id] ?? false}
                onCaptureChange={(v) =>
                  update((s) => {
                    if (v) s.captureLogsByEngine[eng.id] = true
                    else delete s.captureLogsByEngine[eng.id]
                  })
                }
                onIdeChange={(id) =>
                  update((s) => {
                    if (id) s.ideByEngine[eng.id] = id
                    else delete s.ideByEngine[eng.id]
                  })
                }
                onChange={(patch) =>
                  update((s) => {
                    s.engines[i] = { ...s.engines[i], ...patch }
                  })
                }
                onRemove={() =>
                  update((s) => {
                    s.engines = s.engines.filter((x) => x.id !== eng.id)
                    if (s.ideByEngine[eng.id]) delete s.ideByEngine[eng.id]
                  })
                }
              />
            ))}
          </div>
          <button
            onClick={() =>
              update((s) => {
                s.engines.push({
                  id: uid(),
                  name: 'New engine',
                  kind: 'custom',
                  builtin: false,
                  color: nextEngineColor(s.engines),
                  executable: '',
                  argsTemplate: '--project "{path}" {args}',
                  detectExtension: ''
                })
              })
            }
            className="btn-secondary mt-3"
          >
            <Plus size={15} /> Add engine
          </button>
        </Section>

        {/* Unity editors */}
        <Section
          icon={DownloadCloud}
          title="Unity editors"
          desc="Manage Unity versions via Unity Hub — list installed, browse and install new ones."
        >
          <UnityEditorsSection />
        </Section>

        {/* Builds */}
        <Section
          icon={Hammer}
          title="Build commands"
          desc="Per-engine build + optional generate (premake) step and toolchain. Tokens: {exe} {path} {file} {args}."
        >
          <div className="mb-4 rounded-lg bg-bg-soft border border-line p-3">
            <span className="text-sm text-fg-muted">When the editor has the project open</span>
            <p className="mt-0.5 text-[11px] leading-relaxed text-fg-subtle">
              A project can&apos;t be built while an editor holds it. GameBridge can close that
              editor, build, and reopen the project afterwards.
            </p>
            <select
              value={settings.closeEditorForBuild}
              onChange={(e) =>
                update((x) => {
                  x.closeEditorForBuild = e.target.value as Settings['closeEditorForBuild']
                })
              }
              className="input mt-2"
            >
              <option value="ask">Ask me first (recommended)</option>
              <option value="always">Close and reopen without asking</option>
              <option value="never">Never touch the editor — fail the build</option>
            </select>
            {settings.closeEditorForBuild === 'always' && (
              <p className="mt-2 text-[11px] text-warn/90">
                The editor is asked to close normally, so it can still prompt you about unsaved
                work — but you won&apos;t be asked whether to close it at all.
              </p>
            )}
          </div>

          <div className="space-y-4">
            {allEngines(settings.engines).map((eng) => (
              <div key={eng.id} className="rounded-lg bg-bg-soft border border-line p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: eng.color }} />
                  <span className="text-sm text-fg-muted">{eng.name}</span>
                </div>

                <label className="block">
                  <span className="text-[11px] text-fg-subtle">Build command</span>
                  <input
                    value={settings.buildByEngine[eng.id] ?? ''}
                    onChange={(e) =>
                      update((s) => {
                        if (e.target.value) s.buildByEngine[eng.id] = e.target.value
                        else delete s.buildByEngine[eng.id]
                      })
                    }
                    placeholder={DEFAULT_BUILD_TEMPLATES[eng.kind]}
                    className="input font-mono text-xs mt-0.5"
                  />
                </label>

                <label className="block">
                  <span className="text-[11px] text-fg-subtle">Generate command (e.g. premake)</span>
                  <input
                    value={settings.generateByEngine[eng.id] ?? ''}
                    onChange={(e) =>
                      update((s) => {
                        if (e.target.value) s.generateByEngine[eng.id] = e.target.value
                        else delete s.generateByEngine[eng.id]
                      })
                    }
                    placeholder='premake5 gmake2'
                    className="input font-mono text-xs mt-0.5"
                  />
                </label>

                <label className="block">
                  <span className="text-[11px] text-fg-subtle">
                    Toolchain bin — prepended to PATH (e.g. a g++ / make dir)
                  </span>
                  <div className="flex gap-2 mt-0.5">
                    <input
                      value={settings.toolchainBinByEngine[eng.id] ?? ''}
                      onChange={(e) =>
                        update((s) => {
                          if (e.target.value) s.toolchainBinByEngine[eng.id] = e.target.value
                          else delete s.toolchainBinByEngine[eng.id]
                        })
                      }
                      placeholder="C:\msys64\ucrt64\bin;C:\msys64\usr\bin"
                      className="input font-mono text-xs"
                    />
                    <button
                      onClick={async () => {
                        const dir = await window.gamebridge.pickFolder()
                        if (dir) update((s) => (s.toolchainBinByEngine[eng.id] = dir))
                      }}
                      className="btn-secondary shrink-0 text-xs"
                    >
                      Browse
                    </button>
                  </div>
                </label>

                <label className="flex items-center gap-2 cursor-pointer pt-0.5">
                  <input
                    type="checkbox"
                    checked={settings.generateBeforeBuild[eng.id] ?? false}
                    onChange={(e) =>
                      update((s) => {
                        if (e.target.checked) s.generateBeforeBuild[eng.id] = true
                        else delete s.generateBeforeBuild[eng.id]
                      })
                    }
                    className="h-3.5 w-3.5 accent-[#6d8bff]"
                  />
                  <span className="text-xs text-fg-muted">Run generate before each build</span>
                </label>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-fg-subtle">
            Build/generate run in the project folder with the toolchain dir on PATH. Unity needs a
            real build method and Unreal a real target — adjust to your project.
          </p>
        </Section>

        {/* IDEs */}
        <Section
          icon={Code2}
          title="IDEs"
          desc="Editors opened by the split-launch button. Tokens: {path} {sln} {file}."
        >
          <button onClick={detectIdes} className="btn-secondary mb-3">
            <Wand2 size={15} /> Auto-detect IDEs
          </button>
          <div className="space-y-3">
            {settings.ides.map((ide, i) => (
              <IdeEditor
                key={ide.id}
                ide={ide}
                onChange={(patch) =>
                  update((s) => {
                    s.ides[i] = { ...s.ides[i], ...patch }
                  })
                }
                onRemove={() =>
                  update((s) => {
                    s.ides = s.ides.filter((x) => x.id !== ide.id)
                    if (s.defaultIdeId === ide.id) s.defaultIdeId = s.ides[0]?.id
                    for (const k of Object.keys(s.ideByEngine)) {
                      if (s.ideByEngine[k] === ide.id) delete s.ideByEngine[k]
                    }
                  })
                }
              />
            ))}
          </div>
          <button
            onClick={() =>
              update((s) => {
                s.ides.push({
                  id: uid(),
                  name: 'New IDE',
                  executable: '',
                  argsTemplate: '"{path}"'
                })
              })
            }
            className="btn-secondary mt-3"
          >
            <Plus size={15} /> Add IDE
          </button>
        </Section>

      </div>
    </div>
  )
}

function TagManager(): JSX.Element {
  const tags = useStore((s) => s.settings?.tags ?? [])
  const addGlobalTag = useStore((s) => s.addGlobalTag)
  const removeGlobalTag = useStore((s) => s.removeGlobalTag)
  const [val, setVal] = useState('')

  const add = (): void => {
    addGlobalTag(val)
    setVal('')
  }

  return (
    <>
      {tags.length === 0 ? (
        <p className="text-sm text-fg-subtle mb-3">No tags yet — add some below.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {tags.map((t) => (
            <span
              key={t}
              className="flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-md bg-bg-soft border border-line text-xs text-fg-muted"
            >
              {t}
              <button
                onClick={() => removeGlobalTag(t)}
                className="text-fg-subtle hover:text-danger transition-colors"
                title={`Remove "${t}"`}
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
          placeholder="New tag name"
          className="input"
        />
        <button onClick={add} className="btn-secondary shrink-0">
          <Plus size={15} /> Add
        </button>
      </div>
    </>
  )
}

function Section({
  icon: Icon,
  title,
  desc,
  children
}: {
  icon: typeof Cpu
  title: string
  desc: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className="border-t border-line py-6">
      <div className="mb-3 flex items-start gap-2">
        <Icon size={14} className="mt-[3px] shrink-0 text-fg-subtle" />
        <div>
          <h2 className="text-md font-medium tracking-tight text-fg">{title}</h2>
          <p className="mt-0.5 text-sm leading-relaxed text-fg-subtle">{desc}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

function Row({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-bg-soft px-2.5 py-1.5">
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function IdeSelect({
  label,
  value,
  ides,
  onChange,
  allowDefault
}: {
  label: string
  value: string
  ides: IDE[]
  onChange: (id: string) => void
  allowDefault?: boolean
}): JSX.Element {
  return (
    <label className="flex items-center gap-3 py-1.5">
      <span className="w-28 text-sm text-fg-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input flex-1">
        <option value="">{allowDefault ? 'Use default IDE' : '— none —'}</option>
        {ides.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function CustomEngineEditor({
  engine,
  ides,
  ideId,
  captureLogs,
  onCaptureChange,
  onIdeChange,
  onChange,
  onRemove
}: {
  engine: Engine
  ides: IDE[]
  ideId: string
  captureLogs: boolean
  onCaptureChange: (v: boolean) => void
  onIdeChange: (id: string) => void
  onChange: (patch: Partial<Engine>) => void
  onRemove: () => void
}): JSX.Element {
  return (
    <div className="rounded-lg bg-bg-soft border border-line p-3 space-y-2">
      <div className="flex gap-2">
        <input
          type="color"
          value={engine.color}
          onChange={(e) => onChange({ color: e.target.value })}
          title="Badge colour"
          className="h-9 w-9 shrink-0 rounded-lg bg-bg border border-line cursor-pointer"
        />
        <input
          value={engine.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Engine name"
          className="input"
        />
        <input
          value={engine.detectExtension ?? ''}
          onChange={(e) => onChange({ detectExtension: e.target.value })}
          placeholder=".ext (auto-detect)"
          className="input w-40"
        />
        <button onClick={onRemove} className="icon-btn shrink-0" title="Remove">
          <Trash2 size={15} />
        </button>
      </div>
      <ExeField
        value={engine.executable ?? ''}
        onChange={(v) => onChange({ executable: v })}
        placeholder='Executable to run — tokens allowed, e.g. {path}\Bin\Release\Game.exe'
      />
      <input
        value={engine.argsTemplate ?? ''}
        onChange={(e) => onChange({ argsTemplate: e.target.value })}
        placeholder='--project "{path}" {args}'
        className="input font-mono text-xs"
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-muted w-10">IDE</span>
          <InlineIdeSelect ides={ides} value={ideId} onChange={onIdeChange} />
        </div>
        <label className="flex items-center gap-2 cursor-pointer" title="Launching runs the build command first, then starts the executable if it succeeds.">
          <input
            type="checkbox"
            checked={engine.buildBeforeRun ?? false}
            onChange={(e) => onChange({ buildBeforeRun: e.target.checked })}
            className="h-3.5 w-3.5 accent-[#6d8bff]"
          />
          <span className="text-xs text-fg-muted">Build before launch</span>
        </label>
        <label
          className="flex items-center gap-2 cursor-pointer"
          title="Capture the game's stdout/stderr and exit code into the Console view. The game runs as a child of GameBridge (closing GameBridge closes the game)."
        >
          <input
            type="checkbox"
            checked={captureLogs}
            onChange={(e) => onCaptureChange(e.target.checked)}
            className="h-3.5 w-3.5 accent-[#6d8bff]"
          />
          <span className="text-xs text-fg-muted">Show output in console</span>
        </label>
      </div>
    </div>
  )
}

/** Compact IDE dropdown used inline on each engine. */
function InlineIdeSelect({
  ides,
  value,
  onChange
}: {
  ides: IDE[]
  value: string
  onChange: (id: string) => void
}): JSX.Element {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-2.5 py-1.5 rounded-lg bg-bg border border-line text-xs text-fg outline-hidden focus:border-accent/70"
    >
      <option value="">Use default IDE</option>
      {ides.map((i) => (
        <option key={i.id} value={i.id}>
          {i.name}
        </option>
      ))}
    </select>
  )
}

function IdeEditor({
  ide,
  onChange,
  onRemove
}: {
  ide: IDE
  onChange: (patch: Partial<IDE>) => void
  onRemove: () => void
}): JSX.Element {
  return (
    <div className="rounded-lg bg-bg-soft border border-line p-3 space-y-2">
      <div className="flex gap-2">
        <input
          value={ide.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="IDE name"
          className="input"
        />
        <input
          value={ide.argsTemplate}
          onChange={(e) => onChange({ argsTemplate: e.target.value })}
          placeholder='"{sln}"'
          className="input w-40 font-mono text-xs"
        />
        <button onClick={onRemove} className="icon-btn shrink-0" title="Remove">
          <Trash2 size={15} />
        </button>
      </div>
      <ExeField
        value={ide.executable}
        onChange={(v) => onChange({ executable: v })}
        placeholder="Path to IDE executable"
      />
    </div>
  )
}

function ExeField({
  value,
  onChange,
  placeholder
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}): JSX.Element {
  return (
    <div className="flex gap-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input font-mono text-xs"
      />
      <button
        onClick={async () => {
          const exe = await window.gamebridge.pickExecutable()
          if (exe) onChange(exe)
        }}
        className="btn-secondary shrink-0"
      >
        Browse
      </button>
    </div>
  )
}
