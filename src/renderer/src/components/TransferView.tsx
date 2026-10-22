import { useEffect, useMemo, useState, type DragEvent } from 'react'
import { create } from 'zustand'
import {
  AlertTriangle,
  ArrowRightLeft,
  Box,
  Check,
  ChevronRight,
  Clapperboard,
  FolderOpen,
  Image,
  Loader2,
  Minus,
  Music,
  Package,
  PersonStanding,
  Search,
  X
} from 'lucide-react'
import type {
  TransferProgressEvent,
  TransferResult,
  UnrealAssetEntry,
  UnrealAssetKind,
  UnrealScanResult
} from '@shared/types'
import { useStore } from '../store'
import { bytes } from '../lib/format'

type Mode = 'unreal' | 'fab'

/** Kinds that can come across, as the filter chips show them. */
const KIND_GROUPS: { id: string; label: string; kinds: UnrealAssetKind[]; icon: typeof Music }[] = [
  { id: 'audio', label: 'Audio', kinds: ['sound'], icon: Music },
  { id: 'textures', label: 'Textures', kinds: ['texture'], icon: Image },
  { id: 'meshes', label: 'Static meshes', kinds: ['staticMesh'], icon: Box },
  { id: 'characters', label: 'Characters', kinds: ['skeletalMesh'], icon: PersonStanding },
  { id: 'animations', label: 'Animations', kinds: ['animation'], icon: Clapperboard }
]

/** [one, many] */
const STAYS_BEHIND: Partial<Record<UnrealAssetKind, [string, string]>> = {
  soundCue: ['sound cue', 'sound cues'],
  metaSound: ['MetaSound', 'MetaSounds'],
  animationAsset: ['blend space or montage', 'blend spaces and montages'],
  material: ['material', 'materials'],
  skeleton: ['skeleton', 'skeletons'],
  physics: ['physics asset', 'physics assets'],
  blueprint: ['Blueprint', 'Blueprints'],
  level: ['level', 'levels'],
  other: ['other asset', 'other assets']
}

const iconFor = (kind: UnrealAssetKind): typeof Music =>
  KIND_GROUPS.find((g) => g.kinds.includes(kind))?.icon ?? Box

const count = (n: number): string => n.toLocaleString()

/**
 * Lives outside the component so a transfer keeps reporting if the user
 * switches views while it runs.
 */
interface RunState {
  runningId: string | null
  progress: TransferProgressEvent | null
  result: TransferResult | null
  set: (patch: Partial<RunState>) => void
}
const useRun = create<RunState>((set) => ({
  runningId: null,
  progress: null,
  result: null,
  set: (patch) => set(patch)
}))

interface FolderNode {
  name: string
  path: string
  folders: Map<string, FolderNode>
  assets: UnrealAssetEntry[]
}

function buildTree(assets: UnrealAssetEntry[]): FolderNode {
  const root: FolderNode = { name: '', path: '', folders: new Map(), assets: [] }
  for (const asset of assets) {
    const parts = asset.path.split('/')
    let node = root
    for (const part of parts.slice(0, -1)) {
      let next = node.folders.get(part)
      if (!next) {
        next = { name: part, path: node.path ? `${node.path}/${part}` : part, folders: new Map(), assets: [] }
        node.folders.set(part, next)
      }
      node = next
    }
    node.assets.push(asset)
  }
  return root
}

function allAssets(node: FolderNode): UnrealAssetEntry[] {
  return [...node.assets, ...[...node.folders.values()].flatMap(allAssets)]
}

export function TransferView(): JSX.Element {
  const projects = useStore((s) => s.projects)
  const settings = useStore((s) => s.settings)
  const toast = useStore((s) => s.toast)
  const run = useRun()

  const [mode, setMode] = useState<Mode>('unreal')
  const [source, setSource] = useState<string | null>(null)
  const [scan, setScan] = useState<UnrealScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [archive, setArchive] = useState<string | null>(null)

  const unityProjects = projects.filter((p) => p.engineId === 'unity')
  const [unityId, setUnityId] = useState('')
  const unity = unityProjects.find((p) => p.id === unityId)
  const [destination, setDestination] = useState('')
  const [humanoid, setHumanoid] = useState(true)
  const [overwrite, setOverwrite] = useState(false)

  const [groups, setGroups] = useState<Set<string>>(() => new Set(KIND_GROUPS.map((g) => g.id)))
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!unityId && unityProjects.length) setUnityId(unityProjects[0].id)
  }, [unityProjects, unityId])

  useEffect(() => window.gamebridge.onTransferProgress((e) => {
    const st = useRun.getState()
    if (e.transferId === st.runningId) st.set({ progress: e })
  }), [])

  const sources = useMemo(() => {
    const fromLibrary = projects.filter((p) => p.engineId === 'unreal').map((p) => p.path)
    const list: string[] = []
    for (const p of [...(settings?.recentUnrealProjects ?? []), ...fromLibrary]) {
      if (!list.some((x) => x.toLowerCase() === p.toLowerCase())) list.push(p)
    }
    return list
  }, [projects, settings])

  const openSource = async (uproject: string): Promise<void> => {
    setSource(uproject)
    setScan(null)
    setSelected(new Set())
    setScanning(true)
    useRun.getState().set({ result: null })
    try {
      const result = await window.gamebridge.transferScan(uproject, `scan-${Date.now()}`)
      setScan(result)
      setDestination(`Assets/From Unreal/${result.projectName}`)
      setExpanded(new Set())
      useStore.getState().load()
    } catch {
      toast('Could not read that Unreal project.', 'error')
    } finally {
      setScanning(false)
    }
  }

  const browseSource = async (): Promise<void> => {
    const picked = await window.gamebridge.transferPickUproject()
    if (picked) openSource(picked)
  }

  const chooseArchive = (path: string): void => {
    setArchive(path)
    const name = path.split(/[\\/]/).pop()?.replace(/\.(zip|unitypackage)$/i, '') ?? 'Fab'
    setDestination(`Assets/${name}`)
    useRun.getState().set({ result: null })
  }

  const visibleKinds = useMemo(
    () => new Set(KIND_GROUPS.filter((g) => groups.has(g.id)).flatMap((g) => g.kinds)),
    [groups]
  )

  const transferable = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (scan?.assets ?? []).filter(
      (a) => a.route !== 'none' && visibleKinds.has(a.kind) && (!q || a.path.toLowerCase().includes(q))
    )
  }, [scan, visibleKinds, filter])

  const tree = useMemo(() => buildTree(transferable), [transferable])

  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const a of scan?.assets ?? []) counts[a.kind] = (counts[a.kind] ?? 0) + 1
    return counts
  }, [scan])

  const leftBehind = useMemo(
    () =>
      Object.entries(STAYS_BEHIND)
        .map(([kind, [one, many]]) => {
          const n = kindCounts[kind] ?? 0
          return { label: n === 1 ? one : many, n }
        })
        .filter((x) => x.n > 0),
    [kindCounts]
  )

  const chosen = useMemo(() => transferable.filter((a) => selected.has(a.path)), [transferable, selected])
  const needEngine = chosen.filter((a) => a.route === 'engine').length

  const toggleAssets = (list: UnrealAssetEntry[], on: boolean): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const a of list) {
        if (on) next.add(a.path)
        else next.delete(a.path)
      }
      return next
    })
  }

  const toggleExpanded = (path: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const start = async (): Promise<void> => {
    if (!unity) return
    const transferId = `t-${Date.now()}`
    useRun.getState().set({ runningId: transferId, progress: null, result: null })
    const options = { humanoid, overwrite }
    try {
      const result =
        mode === 'unreal' && scan
          ? await window.gamebridge.transferStart(
              {
                uprojectPath: scan.uprojectPath,
                unityProjectPath: unity.path,
                destination,
                paths: chosen.map((a) => a.path),
                options
              },
              transferId
            )
          : await window.gamebridge.transferFab(
              { archivePath: archive as string, unityProjectPath: unity.path, destination, options },
              transferId
            )
      useRun.getState().set({ result, runningId: null })
      // The result panel says it all; a toast is only for someone who has moved on.
      if (useStore.getState().view === 'transfer') return
      const msg = result.cancelled
        ? 'Transfer cancelled'
        : `${count(result.written)} files added to ${unity.name}${result.failed.length ? `, ${result.failed.length} failed` : ''}`
      toast(msg, result.ok ? 'ok' : 'error')
    } catch (e) {
      useRun.getState().set({ runningId: null })
      toast((e as Error).message, 'error')
    }
  }

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file) return
    const path = window.gamebridge.pathForFile(file)
    if (/\.(zip|unitypackage)$/i.test(path)) {
      setMode('fab')
      chooseArchive(path)
    } else {
      toast('Drop a .zip or .unitypackage from Fab.', 'error')
    }
  }

  const running = run.runningId !== null
  const canStart =
    !running &&
    !!unity &&
    destination.trim().length > 0 &&
    (mode === 'unreal' ? chosen.length > 0 : !!archive)

  return (
    <div className="flex h-full" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {/* Setup */}
      <div className="flex w-[300px] shrink-0 flex-col border-r border-line bg-bg-soft">
        <div className="flex h-11 items-center gap-2 px-3">
          <h1 className="text-md font-semibold tracking-tight text-fg">Transfer</h1>
          <span className="text-sm text-fg-faint">to Unity</span>
        </div>

        <div className="px-2 pb-3">
          <div className="flex gap-0.5 rounded-md border border-line bg-bg p-0.5">
            {(
              [
                ['unreal', 'Unreal project'],
                ['fab', 'Fab download']
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setMode(id)}
                className={`flex h-6 flex-1 items-center justify-center rounded text-sm font-medium transition-colors ${
                  mode === id ? 'bg-bg-active text-fg' : 'text-fg-subtle hover:text-fg-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-2 pb-3">
          {mode === 'unreal' ? (
            <section>
              <div className="section-label flex items-center px-2 pb-1">
                From
                <button onClick={browseSource} className="ml-auto normal-case tracking-normal text-fg-subtle hover:text-fg">
                  Browse…
                </button>
              </div>
              {sources.length === 0 ? (
                <p className="px-2 text-xs leading-relaxed text-fg-subtle">
                  Pick the .uproject your Fab packs are added to.
                </p>
              ) : (
                <div className="space-y-px">
                  {sources.map((p) => (
                    <button
                      key={p}
                      onClick={() => openSource(p)}
                      className={`row ${source?.toLowerCase() === p.toLowerCase() ? 'row-selected' : ''}`}
                      title={p}
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-unreal" />
                      <span className="min-w-0 flex-1 truncate">{p.split(/[\\/]/).pop()?.replace(/\.uproject$/i, '')}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          ) : (
            <section>
              <div className="section-label px-2 pb-1">From</div>
              <button
                onClick={async () => {
                  const picked = await window.gamebridge.transferPickArchive()
                  if (picked) chooseArchive(picked)
                }}
                className="flex w-full flex-col items-center gap-1 rounded-md border border-dashed border-line-strong px-3 py-5 text-center transition-colors hover:border-accent/60 hover:bg-bg-hover"
              >
                <Package size={18} className="text-fg-subtle" />
                <span className="text-sm text-fg-muted">
                  {archive ? archive.split(/[\\/]/).pop() : 'Drop or pick a .zip or .unitypackage'}
                </span>
              </button>
            </section>
          )}

          <section className="space-y-1.5">
            <div className="section-label px-2">To</div>
            <select value={unityId} onChange={(e) => setUnityId(e.target.value)} className="input h-7">
              {unityProjects.length === 0 && <option value="">No Unity projects in the library</option>}
              {unityProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="Assets/…"
              className="input h-7 font-mono text-xs"
              title="Folder inside the Unity project"
            />
          </section>

          <section className="space-y-1 px-2">
            <label className="flex cursor-pointer items-start gap-2 text-sm text-fg-muted">
              <Checkbox state={humanoid ? 'on' : 'off'} onChange={() => setHumanoid(!humanoid)} />
              <span>
                Set up characters as Humanoid
                <span className="block text-xs text-fg-faint">So animations retarget onto any humanoid</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 text-sm text-fg-muted">
              <Checkbox state={overwrite ? 'on' : 'off'} onChange={() => setOverwrite(!overwrite)} />
              <span>
                Replace files already there
                <span className="block text-xs text-fg-faint">References to them keep working</span>
              </span>
            </label>
          </section>
        </div>
      </div>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {mode === 'unreal' ? (
          scanning ? (
            <Centered>
              <Loader2 size={20} className="animate-spin text-accent" />
              <p className="mt-2 text-sm text-fg-muted">Reading assets…</p>
            </Centered>
          ) : !scan ? (
            <Centered>
              <ArrowRightLeft size={36} className="mb-3 text-fg-faint" />
              <h3 className="text-md font-medium text-fg">Bring Unreal assets into Unity</h3>
              <p className="mt-1 max-w-md text-base text-fg-muted">
                Pick an Unreal project on the left. Sounds and most textures are copied straight out of
                it. Meshes, characters and animations are exported by Unreal, which runs in the
                background.
              </p>
            </Centered>
          ) : (
            <>
              <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
                <span className="text-md font-medium tracking-tight text-fg">{scan.projectName}</span>
                <span className="text-sm text-fg-faint tabular-nums">{count(scan.assets.length)} assets</span>
                {scan.engineCmdPath ? (
                  <span className="chip">Unreal {scan.engineVersion}</span>
                ) : (
                  <span className="chip border-warn/30 bg-warn/10 text-warn" title="Meshes, characters and animations need it">
                    Unreal {scan.engineVersion ?? ''} not installed
                  </span>
                )}
                <div className="relative ml-auto w-56">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint" />
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filter by name…"
                    className="input h-7 pl-8"
                  />
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-4 py-2">
                {KIND_GROUPS.map((g) => {
                  const n = g.kinds.reduce((sum, k) => sum + (kindCounts[k] ?? 0), 0)
                  const on = groups.has(g.id)
                  return (
                    <button
                      key={g.id}
                      disabled={n === 0}
                      onClick={() =>
                        setGroups((prev) => {
                          const next = new Set(prev)
                          if (next.has(g.id)) next.delete(g.id)
                          else next.add(g.id)
                          return next
                        })
                      }
                      className={`flex h-6 items-center gap-1.5 rounded-md border px-2 text-sm transition-colors disabled:opacity-40 ${
                        on && n > 0
                          ? 'border-accent/50 bg-accent/15 text-fg'
                          : 'border-line bg-bg-soft text-fg-subtle hover:text-fg-muted'
                      }`}
                    >
                      <g.icon size={12} />
                      {g.label}
                      <span className="tabular-nums text-fg-faint">{count(n)}</span>
                    </button>
                  )
                })}
                <button
                  onClick={() => toggleAssets(transferable, chosen.length < transferable.length)}
                  className="btn-ghost ml-auto h-6 px-2 text-sm"
                >
                  {chosen.length < transferable.length ? 'Select all' : 'Select none'}
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-2 py-1">
                {transferable.length === 0 ? (
                  <p className="px-2 py-6 text-center text-sm text-fg-subtle">Nothing here can come across with these filters.</p>
                ) : (
                  <FolderRows
                    node={tree}
                    depth={0}
                    expanded={expanded}
                    selected={selected}
                    onExpand={toggleExpanded}
                    onToggle={toggleAssets}
                  />
                )}
                {leftBehind.length > 0 && (
                  <p className="px-2 pb-2 pt-3 text-xs leading-relaxed text-fg-faint">
                    Staying behind, because Unity has no equivalent:{' '}
                    {leftBehind.map((x) => `${count(x.n)} ${x.label}`).join(', ')}. The sounds, textures and
                    animations they use transfer on their own.
                  </p>
                )}
              </div>
            </>
          )
        ) : (
          <Centered>
            <Package size={36} className="mb-3 text-fg-faint" />
            <h3 className="text-md font-medium text-fg">Import a Fab download</h3>
            <p className="mt-1 max-w-md text-base text-fg-muted">
              Many Fab listings also offer FBX, GLB or Unity-format downloads. Drop the .zip or
              .unitypackage anywhere on this window and it goes into the Unity project, sorted the way
              the pack is.
            </p>
          </Centered>
        )}

        <Footer
          mode={mode}
          chosen={chosen.length}
          needEngine={needEngine}
          engineVersion={scan?.engineVersion}
          unityName={unity?.name}
          destination={destination}
          canStart={canStart}
          onStart={start}
        />
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">{children}</div>
}

function Checkbox({ state, onChange }: { state: 'on' | 'off' | 'some'; onChange: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onChange()
      }}
      className={`mt-px flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors ${
        state === 'off' ? 'border-line-strong bg-bg hover:border-fg-faint' : 'border-accent bg-accent text-accent-fg'
      }`}
    >
      {state === 'on' && <Check size={10} strokeWidth={3} />}
      {state === 'some' && <Minus size={10} strokeWidth={3} />}
    </button>
  )
}

function FolderRows({
  node,
  depth,
  expanded,
  selected,
  onExpand,
  onToggle
}: {
  node: FolderNode
  depth: number
  expanded: Set<string>
  selected: Set<string>
  onExpand: (path: string) => void
  onToggle: (assets: UnrealAssetEntry[], on: boolean) => void
}): JSX.Element {
  const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <>
      {folders.map((f) => {
        const assets = allAssets(f)
        const picked = assets.filter((a) => selected.has(a.path)).length
        const state = picked === 0 ? 'off' : picked === assets.length ? 'on' : 'some'
        const open = expanded.has(f.path)
        const size = assets.reduce((s, a) => s + a.size, 0)
        return (
          <div key={f.path}>
            <div
              className="row cursor-pointer"
              style={{ paddingLeft: 8 + depth * 16 }}
              onClick={() => onExpand(f.path)}
            >
              <ChevronRight size={13} className={`shrink-0 text-fg-faint transition-transform ${open ? 'rotate-90' : ''}`} />
              <Checkbox state={state} onChange={() => onToggle(assets, state !== 'on')} />
              <span className="min-w-0 flex-1 truncate text-fg">{f.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-fg-faint">
                {picked > 0 ? `${count(picked)} of ` : ''}
                {count(assets.length)}
              </span>
              <span className="w-16 shrink-0 text-right text-xs tabular-nums text-fg-faint">{bytes(size)}</span>
            </div>
            {open && (
              <FolderRows
                node={f}
                depth={depth + 1}
                expanded={expanded}
                selected={selected}
                onExpand={onExpand}
                onToggle={onToggle}
              />
            )}
          </div>
        )
      })}
      {node.assets
        .slice()
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((a) => {
          const Icon = iconFor(a.kind)
          const on = selected.has(a.path)
          return (
            <div
              key={a.path}
              className="row cursor-pointer"
              style={{ paddingLeft: 8 + depth * 16 + 19 }}
              onClick={() => onToggle([a], !on)}
            >
              <Checkbox state={on ? 'on' : 'off'} onChange={() => onToggle([a], !on)} />
              <Icon size={13} className="shrink-0 text-fg-faint" />
              <span className="min-w-0 flex-1 truncate">{a.path.split('/').pop()}</span>
              <span
                className={`chip ${a.route === 'engine' ? 'border-unreal/30 text-unreal' : ''}`}
                title={a.route === 'engine' ? 'Exported by Unreal in the background' : 'Copied straight out of the .uasset'}
              >
                .{a.output}
                {a.route === 'engine' ? ' via Unreal' : ''}
              </span>
              <span className="w-16 shrink-0 text-right text-xs tabular-nums text-fg-faint">{bytes(a.size)}</span>
            </div>
          )
        })}
    </>
  )
}

const PHASE_TEXT: Record<string, string> = {
  scanning: 'Reading assets',
  copying: 'Copying',
  'starting-unreal': 'Starting Unreal',
  exporting: 'Exporting with Unreal',
  extracting: 'Unpacking',
  finishing: 'Finishing'
}

function Footer({
  mode,
  chosen,
  needEngine,
  engineVersion,
  unityName,
  destination,
  canStart,
  onStart
}: {
  mode: Mode
  chosen: number
  needEngine: number
  engineVersion?: string
  unityName?: string
  destination: string
  canStart: boolean
  onStart: () => void
}): JSX.Element {
  const { runningId, progress, result, set } = useRun()
  const [showIssues, setShowIssues] = useState(false)

  if (runningId) {
    const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0
    const waiting = !progress || progress.phase === 'starting-unreal'
    return (
      <div className="shrink-0 border-t border-line px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 size={13} className="shrink-0 animate-spin text-accent" />
          <span className="text-fg">{progress ? PHASE_TEXT[progress.phase] : 'Starting'}</span>
          {progress && progress.total > 1 && (
            <span className="tabular-nums text-fg-faint">
              {count(progress.done)} / {count(progress.total)}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-xs text-fg-subtle">{progress?.message}</span>
          <button onClick={() => window.gamebridge.transferCancel(runningId)} className="btn-ghost h-6 px-2 text-sm">
            Cancel
          </button>
        </div>
        <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-bg-hover">
          {waiting ? (
            <div className="h-full w-1/3 animate-[loading_1s_ease-in-out_infinite] bg-accent" />
          ) : (
            <div className="h-full bg-accent transition-all duration-300" style={{ width: `${pct}%` }} />
          )}
        </div>
      </div>
    )
  }

  if (result) {
    const issues = [...result.failed.map((f) => ({ ...f, failed: true })), ...result.skipped.map((s) => ({ ...s, failed: false }))]
    const skippedReasons = [...new Set(result.skipped.map((s) => s.reason))]
    return (
      <div className="shrink-0 border-t border-line px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          {result.failed.length ? (
            <AlertTriangle size={13} className="shrink-0 text-warn" />
          ) : (
            <Check size={13} className="shrink-0 text-ok" />
          )}
          <span className="text-fg">
            {result.cancelled ? 'Cancelled. ' : ''}
            {result.written === 0 && !result.failed.length && result.skipped.length
              ? 'Nothing new to add'
              : `${count(result.written)} ${result.written === 1 ? 'file' : 'files'} added`}
            {result.exported ? ` (${count(result.exported)} exported by Unreal)` : ''}
          </span>
          {result.failed.length > 0 && <span className="text-warn">{count(result.failed.length)} failed</span>}
          {result.skipped.length > 0 && <span className="text-fg-subtle">{count(result.skipped.length)} skipped</span>}
          {issues.length > 0 && (
            <button onClick={() => setShowIssues(!showIssues)} className="text-xs text-fg-subtle hover:text-fg">
              {showIssues ? 'Hide details' : 'Details'}
            </button>
          )}
          <div className="ml-auto flex gap-1">
            {result.destinationDir && (
              <button onClick={() => window.gamebridge.transferReveal(result.destinationDir)} className="btn-secondary h-6 px-2 text-sm">
                <FolderOpen size={13} />
                Show folder
              </button>
            )}
            <button onClick={() => set({ result: null })} className="btn-icon h-6 w-6" title="Dismiss">
              <X size={13} />
            </button>
          </div>
        </div>
        {result.notes.map((n) => (
          <p key={n} className="mt-1.5 text-xs text-fg-muted">
            {n}
          </p>
        ))}
        {!showIssues && skippedReasons.length > 0 && result.failed.length === 0 && (
          <p className="mt-1.5 text-xs text-fg-faint">Skipped: {skippedReasons.join('; ')}.</p>
        )}
        {showIssues && (
          <div className="mt-2 max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-line bg-bg-soft p-2">
            {issues.map((i, n) => (
              <div key={n} className="flex gap-2 text-xs">
                <span className={`shrink-0 ${i.failed ? 'text-warn' : 'text-fg-faint'}`}>{i.failed ? 'Failed' : 'Skipped'}</span>
                <span className="min-w-0 truncate font-mono text-fg-muted" title={i.path}>
                  {i.path || '—'}
                </span>
                <span className="min-w-0 flex-1 truncate text-fg-subtle" title={i.reason}>
                  {i.reason}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const summary =
    mode === 'unreal'
      ? chosen === 0
        ? 'Pick what to bring across'
        : `${count(chosen)} selected${needEngine ? ` · ${count(needEngine)} exported by Unreal ${engineVersion ?? ''}, which takes about a minute to start` : ''}`
      : 'Unpacks into the Unity project'

  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-line px-4 py-3">
      <span className="min-w-0 flex-1 truncate text-sm text-fg-subtle">{summary}</span>
      <span className="hidden max-w-[40%] truncate text-xs text-fg-faint lg:block" title={destination}>
        {unityName ? `${unityName} / ${destination}` : ''}
      </span>
      <button onClick={onStart} disabled={!canStart} className="btn-primary">
        <ArrowRightLeft size={14} />
        Transfer
      </button>
    </div>
  )
}
