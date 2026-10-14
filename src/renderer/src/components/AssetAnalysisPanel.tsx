import { useMemo } from 'react'
import { AlertTriangle, Info, Loader2, RotateCw, Search, XCircle } from 'lucide-react'
import type { AssetFinding, Project } from '@shared/types'
import { useStore } from '../store'
import { bytes, categoryColor } from '../lib/format'

const SEVERITY: Record<AssetFinding['severity'], { icon: JSX.Element; box: string }> = {
  error: {
    icon: <XCircle size={12} className="text-danger" />,
    box: 'border-danger/25 bg-danger/5'
  },
  warn: {
    icon: <AlertTriangle size={12} className="text-warn" />,
    box: 'border-warn/25 bg-warn/5'
  },
  info: {
    icon: <Info size={12} className="text-fg-subtle" />,
    box: 'border-line bg-bg-soft'
  }
}

/**
 * Static scan of the project on disk — works without building, and without the
 * editor being open.
 */
export function AssetAnalysisPanel({ project }: { project: Project }): JSX.Element {
  const scan = useStore((s) => s.assetScans[project.id])
  const scanning = useStore((s) => s.assetScanning[project.id])
  const scanAssets = useStore((s) => s.scanAssets)
  const cancelScan = useStore((s) => s.cancelAssetScan)

  const biggestCategory = useMemo(() => scan?.categories[0]?.bytes ?? 1, [scan])

  if (scanning) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <Loader2 size={26} className="mb-3 animate-spin text-accent" />
        <p className="text-base text-fg">Scanning {project.name}…</p>
        <p className="mt-1 text-sm tabular-nums text-fg-muted">
          {scanning.files.toLocaleString()} files
        </p>
        <p className="mt-1 max-w-lg truncate font-mono text-xs text-fg-faint">{scanning.current}</p>
        <button onClick={() => cancelScan(project.id)} className="btn-secondary mt-4">
          Cancel
        </button>
      </div>
    )
  }

  if (!scan) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <Search size={30} className="mb-3 text-fg-faint" />
        <h3 className="text-md font-medium text-fg">Analyse this project</h3>
        <p className="mt-1 max-w-md text-base text-fg-muted">
          Reads the project folder directly — what&apos;s big, what&apos;s imported badly, what&apos;s
          duplicated, and how much disk the engine&apos;s caches are using. No build required.
        </p>
        <button
          onClick={() => scanAssets(project.id)}
          className="btn-primary mt-4"
        >
          <Search size={14} /> Scan project
        </button>
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-5 overflow-y-auto p-4">
      <div className="flex items-center gap-3">
        <div className="text-xs text-fg-subtle">
          {scan.totalFiles.toLocaleString()} files · {bytes(scan.totalBytes)} of source assets ·
          scanned {new Date(scan.scannedAt).toLocaleString()}
          {scan.truncated && <span className="text-warn"> · stopped at the file limit</span>}
        </div>
        <button
          onClick={() => scanAssets(project.id)}
          className="btn-secondary ml-auto"
        >
          <RotateCw size={12} /> Rescan
        </button>
      </div>

      {/* Findings */}
      {scan.findings.length > 0 && (
        <section>
          <h3 className="section-label mb-1.5">Findings</h3>
          <div className="space-y-1.5">
            {scan.findings.map((f) => {
              const s = SEVERITY[f.severity]
              return (
                <div key={f.id} className={`rounded-md border px-2.5 py-2 ${s.box}`}>
                  <div className="flex items-center gap-2">
                    {s.icon}
                    <span className="text-base font-medium text-fg">{f.title}</span>
                    {f.bytes ? (
                      <span className="ml-auto text-xs tabular-nums text-fg-muted">
                        {bytes(f.bytes)}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-fg-subtle">{f.detail}</p>
                  {f.paths.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {f.paths.map((p) => (
                        <li key={p} className="truncate font-mono text-2xs text-fg-faint">
                          {p}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Category breakdown */}
      <section>
        <h3 className="section-label mb-1.5">Source assets by type</h3>
        <div className="space-y-1.5">
          {scan.categories.slice(0, 12).map((c) => (
            <div key={c.category} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate text-xs text-fg-muted">{c.category}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-hover">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.max(1, (c.bytes / biggestCategory) * 100)}%`,
                    backgroundColor: categoryColor(c.category)
                  }}
                />
              </span>
              <span className="w-20 shrink-0 text-right text-xs tabular-nums text-fg-muted">
                {bytes(c.bytes)}
              </span>
              <span className="w-14 shrink-0 text-right text-xs tabular-nums text-fg-faint">
                {c.files.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Engine caches */}
      {scan.overhead.length > 0 && (
        <section>
          <h3 className="section-label mb-1.5">
            Generated folders
            <span className="ml-1.5 normal-case tracking-normal text-fg-faint">
              not shipped, safe to delete
            </span>
          </h3>
          <div className="flex flex-wrap gap-2">
            {scan.overhead.map((o) => (
              <span
                key={o.category}
                className="rounded-md border border-line bg-bg-soft px-2 py-1 text-xs text-fg-muted"
              >
                {o.category} <span className="tabular-nums text-fg">{bytes(o.bytes)}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Largest files */}
      <section>
        <h3 className="section-label mb-1.5">Largest source files</h3>
        <div className="overflow-hidden rounded-lg border border-line">
          {scan.largest.map((f) => (
            <div
              key={f.path}
              className="flex items-center gap-3 border-b border-line px-2.5 py-1.5 text-xs last:border-0 hover:bg-bg-hover"
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: categoryColor(f.category) }}
              />
              <span className="min-w-0 flex-1 truncate font-mono text-fg-muted" title={f.path}>
                {f.path}
              </span>
              <span className="w-24 shrink-0 truncate text-right text-fg-faint">{f.category}</span>
              <span className="w-20 shrink-0 text-right tabular-nums text-fg">
                {bytes(f.bytes)}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
