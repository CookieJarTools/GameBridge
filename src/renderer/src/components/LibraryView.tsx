import { useCallback, useMemo, useState, type CSSProperties, type PointerEvent } from 'react'
import { Search, RefreshCw, FolderPlus, Gamepad2, Plus, ArrowUp, ArrowDown, Star } from 'lucide-react'
import type { Project } from '@shared/types'
import { useStore } from '../store'
import { useEngines } from '../lib/engine'
import { ProjectRow, COLS, COLUMNS, type ColumnId } from './ProjectRow'
import { ProjectEditModal } from './ProjectEditModal'
import { NewProjectModal } from './NewProjectModal'

export function LibraryView(): JSX.Element {
  const engines = useEngines()
  const [newOpen, setNewOpen] = useState(false)
  const projects = useStore((s) => s.projects)
  const search = useStore((s) => s.search)
  const setSearch = useStore((s) => s.setSearch)
  const activeTags = useStore((s) => s.activeTags)
  const toggleTag = useStore((s) => s.toggleTag)
  const engineFilter = useStore((s) => s.engineFilter)
  const setEngineFilter = useStore((s) => s.setEngineFilter)
  const scan = useStore((s) => s.scan)
  const addManual = useStore((s) => s.addManual)
  const scanning = useStore((s) => s.scanning)

  const [editing, setEditing] = useState<Project | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'modified', desc: true })

  const [widths, setWidth, resetWidth] = useColumnWidths()
  const colVars = Object.fromEntries(
    COLUMNS.map((c) => [`--col-${c.id}`, `${widths[c.id]}px`])
  ) as CSSProperties

  const toggleSort = (key: SortKey): void =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key === 'modified' }))

  const allTags = useMemo(() => {
    const set = new Set<string>()
    projects.forEach((p) => p.tags.forEach((t) => set.add(t)))
    return [...set].sort()
  }, [projects])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return projects
      .filter((p) => engineFilter === 'all' || p.engineId === engineFilter)
      .filter((p) => activeTags.every((t) => p.tags.includes(t)))
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.path.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q))
      )
      .sort((a, b) => {
        // Favourites stay pinned to the top whatever the sort.
        if (!!b.favorite !== !!a.favorite) return b.favorite ? 1 : -1
        const cmp =
          sort.key === 'name'
            ? a.name.localeCompare(b.name)
            : sort.key === 'engine'
              ? (a.engineId ?? '').localeCompare(b.engineId ?? '') ||
                (a.engineVersion ?? '').localeCompare(b.engineVersion ?? '', undefined, { numeric: true })
              : (a.lastOpened ?? 0) - (b.lastOpened ?? 0)
        return sort.desc ? -cmp : cmp
      })
  }, [projects, search, activeTags, engineFilter, sort])

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-line">
        <div className="flex h-11 items-center gap-2 px-4">
          <h1 className="text-md font-semibold tracking-tight text-fg">Library</h1>
          <span className="text-sm text-fg-faint tabular-nums">{filtered.length}</span>

          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={scan} disabled={scanning} className="btn-secondary">
              <RefreshCw size={14} className={scanning ? 'animate-spin' : ''} />
              Scan
            </button>
            <button onClick={addManual} className="btn-secondary">
              <FolderPlus size={14} />
              Add
            </button>
            <button onClick={() => setNewOpen(true)} className="btn-primary">
              <Plus size={14} />
              New project
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 pb-2.5">
          <div className="relative w-64">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects…"
              className="input pl-8"
            />
          </div>

          <div className="flex items-center gap-0.5 rounded-md border border-line bg-bg-soft p-0.5">
            {[{ id: 'all', name: 'All', color: '' }, ...engines].map((f) => (
              <button
                key={f.id}
                onClick={() => setEngineFilter(f.id)}
                className={`flex h-6 items-center gap-1.5 rounded px-2 text-sm font-medium transition-colors ${
                  engineFilter === f.id
                    ? 'bg-bg-active text-fg'
                    : 'text-fg-subtle hover:text-fg-muted'
                }`}
              >
                {f.color && (
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: f.color }} />
                )}
                {f.name}
              </button>
            ))}
          </div>

          {allTags.map((t) => (
            <button
              key={t}
              onClick={() => toggleTag(t)}
              className={`h-6 rounded-md border px-2 text-sm transition-colors ${
                activeTags.includes(t)
                  ? 'border-accent/50 bg-accent/15 text-fg'
                  : 'border-line bg-bg-soft text-fg-subtle hover:text-fg-muted'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <EmptyState hasProjects={projects.length > 0} />
        ) : (
          <div className="min-w-max px-2 pb-2" style={colVars}>
            <div className="sticky top-0 z-10 flex h-8 items-center gap-3 border-b border-line bg-bg px-3 text-xs font-medium text-fg-subtle">
              <span className={`${COLS.star} flex justify-center`}>
                <Star size={12} />
              </span>
              {COLUMNS.map((c) => (
                <div key={c.id} className={`${COLS[c.id]} relative flex h-full items-center`}>
                  {isSortKey(c.id) ? (
                    <SortHeader label={c.label} k={c.id} sort={sort} onSort={toggleSort} />
                  ) : (
                    <span className="truncate">{c.label}</span>
                  )}
                  <ResizeHandle
                    width={widths[c.id]}
                    min={c.min}
                    onResize={(w) => setWidth(c.id, w)}
                    onReset={() => resetWidth(c.id)}
                  />
                </div>
              ))}
            </div>
            <div className="pt-1">
              {filtered.map((p) => (
                <ProjectRow key={p.id} project={p} onEdit={setEditing} />
              ))}
            </div>
          </div>
        )}
      </div>

      {editing && <ProjectEditModal project={editing} onClose={() => setEditing(null)} />}
      {newOpen && <NewProjectModal onClose={() => setNewOpen(false)} />}
    </div>
  )
}

type SortKey = 'name' | 'engine' | 'modified'

const isSortKey = (id: ColumnId): id is SortKey =>
  id === 'name' || id === 'engine' || id === 'modified'

function SortHeader({
  label,
  k,
  sort,
  onSort
}: {
  label: string
  k: SortKey
  sort: { key: SortKey; desc: boolean }
  onSort: (k: SortKey) => void
}): JSX.Element {
  const active = sort.key === k
  const Arrow = sort.desc ? ArrowDown : ArrowUp
  return (
    <button
      onClick={() => onSort(k)}
      className={`flex min-w-0 items-center gap-1 whitespace-nowrap transition-colors hover:text-fg-muted ${
        active ? 'text-fg-muted' : ''
      }`}
    >
      <span className="truncate">{label}</span>
      {active && <Arrow size={11} className="shrink-0" />}
    </button>
  )
}

/** Drag the right edge of a header cell to resize; double-click to reset. */
function ResizeHandle({
  width,
  min,
  onResize,
  onReset
}: {
  width: number
  min: number
  onResize: (w: number) => void
  onReset: () => void
}): JSX.Element {
  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const move = (ev: globalThis.PointerEvent): void =>
      onResize(Math.max(min, Math.round(width + ev.clientX - startX)))
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    document.body.style.cursor = 'col-resize'
  }

  // Sits in the gap after the cell; the hairline only shows on hover or while dragging.
  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      title="Drag to resize · double-click to reset"
      className="group/handle absolute -right-2 top-0 z-10 flex h-full w-2.5 cursor-col-resize justify-center"
    >
      <div className="my-2 w-px bg-line-strong opacity-0 transition-opacity group-hover/handle:opacity-100 group-active/handle:bg-accent group-active/handle:opacity-100" />
    </div>
  )
}

const WIDTHS_KEY = 'gamebridge.library.columns'
const DEFAULT_WIDTHS = Object.fromEntries(COLUMNS.map((c) => [c.id, c.width])) as Record<
  ColumnId,
  number
>

/** Column widths, remembered on this machine. Falls back to defaults if storage is unavailable. */
function useColumnWidths(): [
  Record<ColumnId, number>,
  (id: ColumnId, w: number) => void,
  (id: ColumnId) => void
] {
  const [widths, setWidths] = useState<Record<ColumnId, number>>(() => {
    const merged = { ...DEFAULT_WIDTHS }
    try {
      const saved = JSON.parse(localStorage.getItem(WIDTHS_KEY) ?? '{}')
      for (const c of COLUMNS) {
        if (typeof saved[c.id] === 'number') merged[c.id] = Math.max(c.min, saved[c.id])
      }
    } catch {
      // Unreadable storage: keep the defaults.
    }
    return merged
  })

  const update = useCallback((id: ColumnId, w: number) => {
    setWidths((prev) => {
      const next = { ...prev, [id]: w }
      try {
        localStorage.setItem(WIDTHS_KEY, JSON.stringify(next))
      } catch {
        // Non-essential; widths just won't persist.
      }
      return next
    })
  }, [])

  const reset = useCallback((id: ColumnId) => update(id, DEFAULT_WIDTHS[id]), [update])

  return [widths, update, reset]
}

function EmptyState({ hasProjects }: { hasProjects: boolean }): JSX.Element {
  const scan = useStore((s) => s.scan)
  const addManual = useStore((s) => s.addManual)
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <Gamepad2 size={36} className="mb-3 text-fg-faint" />
      <h3 className="text-md font-medium text-fg">
        {hasProjects ? 'No projects match your filters' : 'No projects yet'}
      </h3>
      <p className="mt-1 max-w-sm text-base text-fg-muted">
        {hasProjects
          ? 'Try clearing the search or tag filters.'
          : 'Add scan roots in Settings and hit Scan, or add a project folder manually.'}
      </p>
      {!hasProjects && (
        <div className="mt-4 flex gap-1.5">
          <button onClick={scan} className="btn-secondary">
            Scan roots
          </button>
          <button onClick={addManual} className="btn-primary">
            Add a project
          </button>
        </div>
      )}
    </div>
  )
}
