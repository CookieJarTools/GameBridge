import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Star, Pencil, GitBranch, Hammer, Code2 } from 'lucide-react'
import type { Project } from '@shared/types'
import { useStore } from '../store'
import { useEngine, timeAgo } from '../lib/engine'
import { SplitLaunchButton } from './SplitLaunchButton'
import { GitPanel } from './GitPanel'
import { BuildPanel } from './BuildPanel'

/** Resizable columns, in display order. Widths are user-adjustable and persisted. */
export const COLUMNS = [
  { id: 'name', label: 'Name', width: 240, min: 120 },
  { id: 'tags', label: 'Tags', width: 192, min: 64 },
  { id: 'engine', label: 'Engine', width: 136, min: 72 },
  { id: 'version', label: 'Version', width: 104, min: 64 },
  { id: 'branch', label: 'Branch', width: 160, min: 64 },
  { id: 'modified', label: 'Modified', width: 112, min: 72 }
] as const

export type ColumnId = (typeof COLUMNS)[number]['id']

/**
 * Each column reads its width from a CSS variable set once on the list, so the
 * header and every row stay aligned and dragging a column doesn't re-render rows.
 */
export const COLS = {
  star: 'w-5 shrink-0',
  name: 'w-(--col-name) min-w-0 shrink-0',
  tags: 'w-(--col-tags) min-w-0 shrink-0',
  engine: 'flex w-(--col-engine) min-w-0 shrink-0',
  version: 'w-(--col-version) min-w-0 shrink-0',
  branch: 'flex w-(--col-branch) min-w-0 shrink-0',
  modified: 'w-(--col-modified) min-w-0 shrink-0'
}

interface Props {
  project: Project
  onEdit: (p: Project) => void
}

export function ProjectRow({ project, onEdit }: Props): JSX.Element {
  const launch = useStore((s) => s.launch)
  const updateProject = useStore((s) => s.updateProject)
  const refreshGit = useStore((s) => s.refreshGit)
  const startBuild = useStore((s) => s.startBuild)
  const activeTags = useStore((s) => s.activeTags)
  const toggleTag = useStore((s) => s.toggleTag)
  const git = useStore((s) => s.gitStatus[project.id])
  const building = useStore((s) => s.builds[s.buildByProject[project.id] ?? '']?.running ?? false)
  const engine = useEngine(project.engineId)
  const engineColor = engine?.color ?? '#62666d'

  const [gitOpen, setGitOpen] = useState(false)

  // Check git status once when the row mounts.
  useEffect(() => {
    refreshGit(project)
  }, [project, refreshGit])

  return (
    <div>
      <div
        onClick={() => launch(project, 'project')}
        className="group relative flex h-11 cursor-pointer items-center gap-3 rounded-md px-3 transition-colors hover:bg-bg-hover"
      >
        <button
          onClick={(e) => {
            e.stopPropagation()
            updateProject(project.id, { favorite: !project.favorite })
          }}
          className={`no-drag ${COLS.star} flex justify-center transition-colors ${
            project.favorite ? 'text-warn' : 'text-fg-faint hover:text-fg-muted'
          }`}
          title={project.favorite ? 'Unfavorite' : 'Favorite'}
        >
          <Star size={14} fill={project.favorite ? 'currentColor' : 'none'} />
        </button>

        <div className={COLS.name}>
          <p className="truncate text-base font-medium text-fg">{project.name}</p>
          <p className="truncate text-xs text-fg-subtle" title={project.path}>
            {project.path}
          </p>
        </div>

        {/* Fixed width: extra tags scroll sideways instead of widening the column. */}
        <div className={COLS.tags}>
          <TagStrip>
            {project.tags.map((t) => (
              <button
                key={t}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleTag(t)
                }}
                title={activeTags.includes(t) ? `Stop filtering by ${t}` : `Filter by ${t}`}
                className={`no-drag chip transition-colors hover:text-fg ${
                  activeTags.includes(t) ? 'border-accent/50 bg-accent/15 text-fg' : ''
                }`}
              >
                {t}
              </button>
            ))}
          </TagStrip>
        </div>

        <div className={`${COLS.engine} items-center gap-1.5 text-sm text-fg-muted`}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: engineColor }} />
          <span className="truncate">{engine?.name ?? 'Unassigned'}</span>
        </div>

        <span className={`${COLS.version} truncate text-sm tabular-nums text-fg-muted`}>
          {project.engineVersion ?? '—'}
        </span>

        <div className={`${COLS.branch} min-w-0`}>
          {git?.isRepo ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setGitOpen(true)
              }}
              title="Git"
              className="no-drag flex min-w-0 items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
            >
              <GitBranch size={12} className="shrink-0 text-fg-subtle" />
              <span className="truncate">{git.branch}</span>
              {git.dirty && (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" title="Uncommitted changes" />
              )}
            </button>
          ) : (
            <span className="text-sm text-fg-faint">—</span>
          )}
        </div>

        <span className={`${COLS.modified} truncate text-sm text-fg-subtle`}>
          {timeAgo(project.lastOpened)}
        </span>

        {/* Actions float over the right of the row on hover, so they cost no column space. */}
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 rounded-r-md bg-[linear-gradient(to_left,var(--color-bg-hover)_85%,transparent)] pl-10 pr-2 opacity-0 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation()
              launch(project, 'ide')
            }}
            className="btn-icon no-drag"
            title="Open IDE only (no build, no launch)"
          >
            <Code2 size={14} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              startBuild(project)
            }}
            disabled={building}
            className="btn-icon no-drag disabled:opacity-40"
            title="Build project"
          >
            <Hammer size={14} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onEdit(project)
            }}
            className="btn-icon no-drag"
            title="Edit"
          >
            <Pencil size={14} />
          </button>
          <div className="ml-1" onClick={(e) => e.stopPropagation()}>
            <SplitLaunchButton project={project} />
          </div>
        </div>
      </div>

      <BuildPanel project={project} />

      {gitOpen && <GitPanel project={project} onClose={() => setGitOpen(false)} />}
    </div>
  )
}

/**
 * Horizontal tag strip. A plain mouse wheel scrolls it sideways while it can
 * still move; at either end the wheel falls through so the list keeps scrolling.
 * Uses a native listener because React's wheel handlers are passive.
 */
function TagStrip({ children }: { children: ReactNode }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (e.deltaX !== 0 || el.scrollWidth <= el.clientWidth) return
      const atStart = el.scrollLeft <= 0 && e.deltaY < 0
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 && e.deltaY > 0
      if (atStart || atEnd) return
      el.scrollLeft += e.deltaY
      e.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div ref={ref} className="scroll-x-thin flex gap-1 overflow-x-auto py-1">
      {children}
    </div>
  )
}
