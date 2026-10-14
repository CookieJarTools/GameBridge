import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ChevronRight,
  FileJson,
  FolderOpen,
  Home,
  Loader2,
  RotateCcw,
  Save,
  Search,
  Settings2
} from 'lucide-react'
import type { JsonFileEntry, JsonReadResult } from '@shared/types'
import { useStore } from '../store'
import { JsonEditor } from './JsonEditor'
import { humanise, serialise, type JsonPath } from '../lib/jsonModel'
import { bytes } from '../lib/format'

/**
 * Browse and edit the JSON files in a project without knowing any JSON.
 * The form editor is the point; the Text view is the escape hatch.
 */
export function DataView(): JSX.Element {
  const projects = useStore((s) => s.projects)
  const toast = useStore((s) => s.toast)

  const [projectId, setProjectId] = useState('')
  const [files, setFiles] = useState<JsonFileEntry[]>([])
  const [listing, setListing] = useState(false)
  const [filter, setFilter] = useState('')

  const [file, setFile] = useState<JsonReadResult | null>(null)
  const [draft, setDraft] = useState<unknown>(undefined)
  const [rawDraft, setRawDraft] = useState('')
  const [path, setPath] = useState<JsonPath>([])
  const [structure, setStructure] = useState(false)
  const [raw, setRaw] = useState(false)
  const [saving, setSaving] = useState(false)

  const project = projects.find((p) => p.id === projectId)

  // Default to the first project once the library has loaded.
  useEffect(() => {
    if (!projectId && projects.length) setProjectId(projects[0].id)
  }, [projects, projectId])

  useEffect(() => {
    if (!project) return
    let live = true
    setListing(true)
    setFiles([])
    window.gamebridge
      .jsonList(project.id)
      .then((found) => live && setFiles(found))
      .catch(() => live && toast('Could not read that project folder.', 'error'))
      .finally(() => live && setListing(false))
    return () => {
      live = false
    }
  }, [project, toast])

  const dirty = useMemo(() => {
    if (!file) return false
    if (raw) return rawDraft !== file.text
    if (draft === undefined) return false
    return serialise(draft, file.indent) !== file.text
  }, [file, draft, rawDraft, raw])

  const open = async (target: { path: string }): Promise<void> => {
    if (dirty && !confirm('Discard the changes you have not saved?')) return
    const result = await window.gamebridge.jsonRead(target.path)
    setFile(result)
    setDraft(result.value)
    setRawDraft(result.text)
    setPath([])
    setStructure(false)
    setRaw(!!result.error || result.tooLarge)
    if (result.error && !result.tooLarge) {
      toast('That file is not valid JSON — opened as text so you can fix it.', 'error')
    }
  }

  const openExternal = async (): Promise<void> => {
    const picked = await window.gamebridge.jsonPick()
    if (picked) await open({ path: picked })
  }

  const save = async (): Promise<void> => {
    if (!file) return
    const text = raw ? rawDraft : serialise(draft, file.indent)
    setSaving(true)
    try {
      const result = await window.gamebridge.jsonWrite(file.path, text)
      toast(result.message, result.ok ? 'ok' : 'error')
      if (result.ok) {
        setFile({ ...file, text, value: raw ? safeParse(text) : draft, error: undefined })
        if (raw) setDraft(safeParse(text))
      }
    } finally {
      setSaving(false)
    }
  }

  const revert = (): void => {
    if (!file) return
    setDraft(file.value)
    setRawDraft(file.text)
  }

  const grouped = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const matched = q
      ? files.filter((f) => f.relativePath.toLowerCase().includes(q))
      : files
    const map = new Map<string, JsonFileEntry[]>()
    for (const f of matched) {
      const list = map.get(f.folder) ?? []
      list.push(f)
      map.set(f.folder, list)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [files, filter])

  return (
    <div className="flex h-full">
      {/* Files */}
      <div className="flex w-[280px] shrink-0 flex-col border-r border-line bg-bg-soft">
        <div className="flex h-11 items-center gap-2 px-3">
          <h1 className="text-md font-semibold tracking-tight text-fg">Data</h1>
          <button onClick={openExternal} className="btn-icon ml-auto" title="Open a file anywhere">
            <FolderOpen size={15} />
          </button>
        </div>

        <div className="space-y-2 px-2 pb-2">
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="input h-7"
          >
            {projects.length === 0 && <option value="">No projects yet</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search files…"
              className="input h-7 pl-8"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {listing ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 size={16} className="animate-spin text-accent" />
            </div>
          ) : files.length === 0 ? (
            <p className="px-2 py-4 text-xs leading-relaxed text-fg-subtle">
              No JSON files in this project. Use the folder button above to open one from anywhere.
            </p>
          ) : (
            grouped.map(([folder, list]) => (
              <div key={folder} className="mb-2">
                <div className="section-label truncate px-2 py-1" title={folder || 'Project root'}>
                  {folder || 'Project root'}
                </div>
                <div className="space-y-px">
                  {list.map((f) => (
                    <button
                      key={f.path}
                      onClick={() => open(f)}
                      className={`row ${file?.path === f.path ? 'row-selected' : ''}`}
                      title={f.relativePath}
                    >
                      <FileJson size={13} className="shrink-0 text-fg-faint" />
                      <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      <span className="shrink-0 text-2xs tabular-nums text-fg-faint">
                        {bytes(f.bytes)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!file ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <FileJson size={36} className="mb-3 text-fg-faint" />
            <h3 className="text-md font-medium text-fg">Pick a file to edit</h3>
            <p className="mt-1 max-w-md text-base text-fg-muted">
              Every field is shown with its name and what kind of value it holds. Click into a group
              or list to see what is inside, and change values without touching a bracket.
            </p>
          </div>
        ) : (
          <>
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
              <span className="truncate text-md font-medium tracking-tight text-fg">
                {file.name}
              </span>
              {dirty && (
                <span className="chip border-warn/30 bg-warn/10 text-warn">unsaved</span>
              )}
              <span className="truncate text-xs text-fg-faint" title={file.path}>
                {bytes(file.bytes)}
              </span>

              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={() => setRaw(!raw)}
                  disabled={!!file.error || file.tooLarge}
                  className={`btn ${raw ? 'bg-bg-active text-fg' : 'btn-ghost'}`}
                  title="Show the file as text"
                >
                  Text
                </button>
                {!raw && (
                  <button
                    onClick={() => setStructure(!structure)}
                    className={`btn ${structure ? 'bg-accent/15 text-accent' : 'btn-ghost'}`}
                    title="Add, rename, delete or retype fields"
                  >
                    <Settings2 size={13} /> Edit structure
                  </button>
                )}
                <button onClick={revert} disabled={!dirty} className="btn-ghost">
                  <RotateCcw size={13} /> Revert
                </button>
                <button onClick={save} disabled={!dirty || saving} className="btn-primary">
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  Save
                </button>
              </div>
            </div>

            {/* Warnings */}
            {(file.error || file.numericKeys || file.tooLarge) && (
              <div className="shrink-0 space-y-1.5 border-b border-line px-3 py-2">
                {file.error && (
                  <Notice tone="danger">
                    This file isn&apos;t valid JSON, so it can only be edited as text.{' '}
                    <span className="font-mono">{file.error}</span>
                  </Notice>
                )}
                {file.tooLarge && (
                  <Notice tone="warn">
                    This file is over 5 MB — too big for the form editor, so it opens as text.
                  </Notice>
                )}
                {file.numericKeys && !file.error && (
                  <Notice tone="warn">
                    Some field names here are numbers. Saving may reorder those fields, which
                    matters if something reads them in order.
                  </Notice>
                )}
              </div>
            )}

            {raw ? (
              <textarea
                value={rawDraft}
                onChange={(e) => setRawDraft(e.target.value)}
                spellCheck={false}
                className="flex-1 resize-none bg-bg p-4 font-mono text-[11.5px] leading-[1.6] text-fg-muted outline-none"
              />
            ) : (
              <>
                <Breadcrumbs value={draft} path={path} onNavigate={setPath} />
                <JsonEditor
                  value={draft}
                  onChange={setDraft}
                  structure={structure}
                  path={path}
                  onNavigate={setPath}
                />
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function Notice({
  tone,
  children
}: {
  tone: 'warn' | 'danger'
  children: React.ReactNode
}): JSX.Element {
  const style =
    tone === 'danger'
      ? 'border-danger/25 bg-danger/[0.06] text-[#f7c9cb]'
      : 'border-warn/25 bg-warn/[0.06] text-[#f6e6b4]'
  return (
    <div className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs ${style}`}>
      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
      <span className="leading-relaxed">{children}</span>
    </div>
  )
}

/** Where you are in the file, and the way back out. */
function Breadcrumbs({
  value,
  path,
  onNavigate
}: {
  value: unknown
  path: JsonPath
  onNavigate: (p: JsonPath) => void
}): JSX.Element {
  return (
    <div className="flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line px-3 text-xs">
      <button
        onClick={() => onNavigate([])}
        className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 transition-colors ${
          path.length === 0 ? 'text-fg' : 'text-fg-subtle hover:text-fg'
        }`}
      >
        <Home size={11} /> Whole file
      </button>
      {path.map((step, i) => {
        const parent = path.slice(0, i)
        const inList = Array.isArray(getAtLocal(value, parent))
        return (
          <span key={i} className="flex shrink-0 items-center gap-0.5">
            <ChevronRight size={11} className="text-fg-faint" />
            <button
              onClick={() => onNavigate(path.slice(0, i + 1))}
              className={`rounded px-1.5 py-0.5 transition-colors ${
                i === path.length - 1 ? 'text-fg' : 'text-fg-subtle hover:text-fg'
              }`}
            >
              {inList ? `Item ${Number(step) + 1}` : humanise(String(step))}
            </button>
          </span>
        )
      })}
    </div>
  )
}

function getAtLocal(root: unknown, path: JsonPath): unknown {
  let current = root
  for (const step of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string | number, unknown>)[step]
  }
  return current
}
