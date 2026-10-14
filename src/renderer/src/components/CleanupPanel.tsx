import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Archive,
  Info,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
  Undo2
} from 'lucide-react'
import type { CleanupCandidate, CleanupConfidence, CleanupReason, Project } from '@shared/types'
import type { BuildUi } from '../store'
import { useStore } from '../store'
import { bytes } from '../lib/format'

const REASON_LABEL: Record<CleanupReason, string> = {
  'not-in-build': 'Not in the last build',
  'unused-scene': 'Scene not in the build',
  duplicate: 'Duplicate files',
  'orphan-meta': 'Orphaned .meta files',
  'source-art': 'Layered source art'
}

const CONFIDENCE: Record<CleanupConfidence, { label: string; chip: string }> = {
  high: { label: 'likely safe', chip: 'border-ok/30 bg-ok/10 text-ok' },
  medium: { label: 'check first', chip: 'border-warn/30 bg-warn/10 text-warn' },
  low: { label: 'risky', chip: 'border-danger/30 bg-danger/10 text-danger' }
}

/**
 * What the project could lose, and the three things you can do about it:
 * mark as needed, move to quarantine, or send to the Recycle Bin.
 */
export function CleanupPanel({
  project,
  build
}: {
  project: Project
  build?: BuildUi
}): JSX.Element {
  const report = useStore((s) => s.cleanup[project.id])
  const scanning = useStore((s) => s.cleanupScanning[project.id])
  const quarantine = useStore((s) => s.quarantine)
  const scanCleanup = useStore((s) => s.scanCleanup)
  const markNeeded = useStore((s) => s.markNeeded)
  const quarantineAssets = useStore((s) => s.quarantineAssets)
  const trashAssets = useStore((s) => s.trashAssets)
  const loadQuarantine = useStore((s) => s.loadQuarantine)
  const restoreQuarantined = useStore((s) => s.restoreQuarantined)
  const emptyQuarantine = useStore((s) => s.emptyQuarantine)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<'quarantine' | 'trash' | 'empty' | null>(null)

  const buildId = build?.phase === 'succeeded' ? build.id : undefined

  useEffect(() => {
    loadQuarantine()
  }, [loadQuarantine])

  // Selections don't survive a rescan — the paths may not exist any more.
  useEffect(() => setSelected(new Set()), [report])

  const groups = useMemo(() => {
    if (!report) return []
    const map = new Map<CleanupReason, CleanupCandidate[]>()
    for (const c of report.candidates) {
      const list = map.get(c.reason) ?? []
      list.push(c)
      map.set(c.reason, list)
    }
    return [...map.entries()].map(([reason, items]) => ({
      reason,
      items,
      bytes: items.reduce((n, i) => n + i.bytes, 0)
    }))
  }, [report])

  const mine = useMemo(
    () => quarantine.filter((q) => q.projectId === project.id),
    [quarantine, project.id]
  )

  const selectedBytes = useMemo(() => {
    if (!report) return 0
    return report.candidates
      .filter((c) => selected.has(c.path))
      .reduce((n, c) => n + c.bytes, 0)
  }, [report, selected])

  const toggle = (path: string): void =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const toggleMany = (paths: string[], on: boolean): void =>
    setSelected((s) => {
      const next = new Set(s)
      for (const p of paths) {
        if (on) next.add(p)
        else next.delete(p)
      }
      return next
    })

  const run = async (what: 'quarantine' | 'trash'): Promise<void> => {
    const paths = [...selected]
    setConfirm(null)
    if (what === 'quarantine') await quarantineAssets(project.id, paths, buildId)
    else await trashAssets(project.id, paths, buildId)
  }

  if (scanning) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <Loader2 size={26} className="mb-3 animate-spin text-accent" />
        <p className="text-base text-fg">Working out what {project.name} can lose…</p>
      </div>
    )
  }

  if (!report) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <Sparkles size={30} className="mb-3 text-fg-faint" />
        <h3 className="text-md font-medium text-fg">Find what this project can lose</h3>
        <p className="mt-1 max-w-lg text-base text-fg-muted">
          Compares the project against{' '}
          {buildId ? 'this build' : 'a successful build, when there is one'} and adds what can be
          judged from the folder alone — duplicates, orphaned .meta files, source art. Nothing is
          moved without you saying so.
        </p>
        <button onClick={() => scanCleanup(project.id, buildId)} className="btn-primary mt-4">
          <Sparkles size={14} /> Analyse project
        </button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Summary + rescan */}
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-2">
        <span className="text-xs text-fg-subtle">
          {report.candidates.length.toLocaleString()} candidate
          {report.candidates.length === 1 ? '' : 's'} · {bytes(report.totalBytes)} ·{' '}
          {report.heuristicsOnly ? (
            <span className="text-warn">no build to compare against</span>
          ) : (
            <>compared with {report.buildLabel}</>
          )}
        </span>
        <button
          onClick={() => scanCleanup(project.id, buildId)}
          className="btn-secondary ml-auto"
        >
          <RotateCcw size={12} /> Rescan
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        {/* What makes this unreliable */}
        {report.caveats.length > 0 && (
          <div className="space-y-1.5">
            {report.caveats.map((c) => (
              <div
                key={c}
                className="flex items-start gap-2 rounded-md border border-warn/25 bg-warn/5 px-2.5 py-2 text-xs leading-relaxed text-[#f6e6b4]"
              >
                <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warn" />
                <span>{c}</span>
              </div>
            ))}
          </div>
        )}

        {report.heuristicsOnly && (
          <div className="flex items-start gap-2 rounded-md border border-line bg-bg-soft px-2.5 py-2 text-xs leading-relaxed text-fg-muted">
            <Info size={12} className="mt-0.5 shrink-0 text-fg-subtle" />
            <span>
              No successful build to compare against, so this is only what the folder itself gives
              away. Build the project and rescan to find assets that never shipped.
            </span>
          </div>
        )}

        {groups.length === 0 ? (
          <p className="py-8 text-center text-base text-fg-muted">
            Nothing to suggest — this project looks tidy.
          </p>
        ) : (
          groups.map((group) => {
            const paths = group.items.map((i) => i.path)
            const allOn = paths.every((p) => selected.has(p))
            return (
              <section key={group.reason}>
                <div className="mb-1.5 flex items-center gap-2">
                  <h3 className="section-label">{REASON_LABEL[group.reason]}</h3>
                  <span className="text-xs tabular-nums text-fg-faint">
                    {group.items.length} · {bytes(group.bytes)}
                  </span>
                  <button
                    onClick={() => toggleMany(paths, !allOn)}
                    className="ml-auto text-xs text-fg-subtle hover:text-fg"
                  >
                    {allOn ? 'Deselect all' : 'Select all'}
                  </button>
                </div>

                <div className="overflow-hidden rounded-lg border border-line">
                  {group.items.slice(0, 300).map((c) => (
                    <label
                      key={c.path}
                      className="flex cursor-pointer items-center gap-2.5 border-b border-line px-2.5 py-1.5 text-xs last:border-0 hover:bg-bg-hover"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(c.path)}
                        onChange={() => toggle(c.path)}
                        className="accent-accent"
                      />
                      <span
                        className="min-w-0 flex-1 truncate font-mono text-fg-muted"
                        title={`${c.path}\n${c.detail}`}
                      >
                        {c.path}
                      </span>
                      <span className={`chip ${CONFIDENCE[c.confidence].chip}`}>
                        {CONFIDENCE[c.confidence].label}
                      </span>
                      <span className="w-20 shrink-0 text-right tabular-nums text-fg">
                        {bytes(c.bytes)}
                      </span>
                    </label>
                  ))}
                  {group.items.length > 300 && (
                    <div className="px-2.5 py-1.5 text-xs text-fg-faint">
                      …and {group.items.length - 300} more, hidden to keep this readable.
                    </div>
                  )}
                </div>
              </section>
            )
          })
        )}

        {/* Quarantine */}
        {mine.length > 0 && (
          <section>
            <div className="mb-1.5 flex items-center gap-2">
              <h3 className="section-label">In quarantine</h3>
              <span className="text-xs tabular-nums text-fg-faint">
                {mine.length} · {bytes(mine.reduce((n, q) => n + q.bytes, 0))}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={() => restoreQuarantined(mine.map((q) => q.id), project.id, buildId)}
                  className="btn-ghost"
                >
                  <Undo2 size={12} /> Restore all
                </button>
                <button onClick={() => setConfirm('empty')} className="btn-danger">
                  <Trash2 size={12} /> Empty to Recycle Bin
                </button>
              </div>
            </div>
            <div className="overflow-hidden rounded-lg border border-line">
              {mine.slice(0, 200).map((q) => (
                <div
                  key={q.id}
                  className="flex items-center gap-2.5 border-b border-line px-2.5 py-1.5 text-xs last:border-0 hover:bg-bg-hover"
                >
                  <Archive size={11} className="shrink-0 text-fg-faint" />
                  <span className="min-w-0 flex-1 truncate font-mono text-fg-muted">
                    {q.originalPath}
                  </span>
                  <span className="w-20 shrink-0 text-right tabular-nums text-fg-muted">
                    {bytes(q.bytes)}
                  </span>
                  <button
                    onClick={() => restoreQuarantined([q.id], project.id, buildId)}
                    className="shrink-0 text-fg-subtle hover:text-fg"
                    title="Put it back"
                  >
                    <Undo2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Marked as needed */}
        {report.keep.length > 0 && (
          <section>
            <div className="mb-1.5 flex items-center gap-2">
              <h3 className="section-label">Marked as needed</h3>
              <span className="text-xs tabular-nums text-fg-faint">{report.keep.length}</span>
              <button
                onClick={() => markNeeded(project.id, report.keep, false)}
                className="ml-auto text-xs text-fg-subtle hover:text-fg"
              >
                Clear all
              </button>
            </div>
            <div className="overflow-hidden rounded-lg border border-line">
              {report.keep.map((p) => (
                <div
                  key={p}
                  className="flex items-center gap-2.5 border-b border-line px-2.5 py-1.5 text-xs last:border-0 hover:bg-bg-hover"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-fg-subtle">{p}</span>
                  <button
                    onClick={() => markNeeded(project.id, [p], false)}
                    className="shrink-0 text-fg-subtle hover:text-fg"
                  >
                    Unmark
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Action bar */}
      {selected.size > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-t border-line bg-bg-soft px-3 py-2">
          <span className="text-xs tabular-nums text-fg-muted">
            {selected.size} selected · {bytes(selectedBytes)}
          </span>
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-fg-subtle hover:text-fg"
          >
            Clear
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => markNeeded(project.id, [...selected], true)} className="btn-ghost">
              Mark as needed
            </button>
            <button onClick={() => setConfirm('trash')} className="btn-danger">
              <Trash2 size={13} /> Recycle Bin
            </button>
            <button onClick={() => setConfirm('quarantine')} className="btn-primary">
              <Archive size={13} /> Move to quarantine
            </button>
          </div>
        </div>
      )}

      {confirm && (
        <Confirm
          kind={confirm}
          count={confirm === 'empty' ? mine.length : selected.size}
          size={confirm === 'empty' ? mine.reduce((n, q) => n + q.bytes, 0) : selectedBytes}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            if (confirm === 'empty') {
              setConfirm(null)
              emptyQuarantine(mine.map((q) => q.id))
            } else {
              run(confirm)
            }
          }}
        />
      )}
    </div>
  )
}

function Confirm({
  kind,
  count,
  size,
  onCancel,
  onConfirm
}: {
  kind: 'quarantine' | 'trash' | 'empty'
  count: number
  size: number
  onCancel: () => void
  onConfirm: () => void
}): JSX.Element {
  const copy = {
    quarantine: {
      title: 'Move to quarantine',
      body: 'These move to a folder beside the project, so the engine stops seeing them. Build and test, then restore anything you still need or empty the folder to the Recycle Bin.',
      action: 'Move',
      danger: false
    },
    trash: {
      title: 'Send to the Recycle Bin',
      body: 'These go straight to the Recycle Bin, along with their .meta files. Recoverable from there until you empty it.',
      action: 'Send to Recycle Bin',
      danger: true
    },
    empty: {
      title: 'Empty quarantine',
      body: 'Everything in this project’s quarantine folder goes to the Recycle Bin. Restore anything you still want first.',
      action: 'Empty',
      danger: true
    }
  }[kind]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="w-full max-w-[420px] rounded-lg border border-line bg-bg-panel shadow-popover">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <AlertTriangle size={14} className={copy.danger ? 'text-danger' : 'text-accent'} />
          <h2 className="text-md font-medium tracking-tight text-fg">{copy.title}</h2>
        </div>
        <div className="p-4">
          <p className="text-base text-fg-muted">
            <span className="text-fg">
              {count} file{count === 1 ? '' : 's'}
            </span>{' '}
            · {bytes(size)}
          </p>
          <p className="mt-2 text-base leading-relaxed text-fg-subtle">{copy.body}</p>
          <div className="mt-4 flex items-center justify-end gap-1.5">
            <button onClick={onCancel} className="btn-ghost">
              Cancel
            </button>
            <button onClick={onConfirm} className={copy.danger ? 'btn-danger' : 'btn-primary'}>
              {copy.action}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
