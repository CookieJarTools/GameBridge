import { useEffect, useMemo, useState } from 'react'
import { Boxes, Loader2, Search } from 'lucide-react'
import type { PackedAssetInfo } from '@shared/types'
import type { BuildUi } from '../store'
import { bytes, categoryColor } from '../lib/format'

type SortKey = 'size' | 'path' | 'type'

/** Everything the build actually shipped, straight from Unity's report. */
export function BuildAssetsPanel({ build }: { build: BuildUi }): JSX.Element {
  const [assets, setAssets] = useState<PackedAssetInfo[] | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('size')
  const [limit, setLimit] = useState(200)

  // The record only keeps the biggest 500; the report file has the rest.
  useEffect(() => {
    let live = true
    setAssets(null)
    window.gamebridge
      .buildAssets(build.id)
      .then((list) => {
        if (!live) return
        setAssets(list.length ? list : (build.report?.assets ?? []))
      })
      .catch(() => live && setAssets(build.report?.assets ?? []))
    return () => {
      live = false
    }
  }, [build.id, build.report])

  const byType = useMemo(() => {
    if (!assets) return []
    const totals = new Map<string, { bytes: number; count: number }>()
    for (const a of assets) {
      const key = a.type || 'Other'
      const cur = totals.get(key) ?? { bytes: 0, count: 0 }
      cur.bytes += a.bytes
      cur.count++
      totals.set(key, cur)
    }
    return [...totals.entries()]
      .map(([type, v]) => ({ type, ...v }))
      .sort((a, b) => b.bytes - a.bytes)
  }, [assets])

  const shown = useMemo(() => {
    if (!assets) return []
    const q = query.trim().toLowerCase()
    const filtered = q
      ? assets.filter(
          (a) => a.path.toLowerCase().includes(q) || a.type.toLowerCase().includes(q)
        )
      : assets
    const sorted = [...filtered]
    if (sort === 'size') sorted.sort((a, b) => b.bytes - a.bytes)
    if (sort === 'path') sorted.sort((a, b) => a.path.localeCompare(b.path))
    if (sort === 'type') sorted.sort((a, b) => a.type.localeCompare(b.type) || b.bytes - a.bytes)
    return sorted
  }, [assets, query, sort])

  if (!build.report) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <Boxes size={30} className="mb-3 text-fg-faint" />
        <p className="max-w-md text-base text-fg-muted">
          {build.running
            ? 'The asset list is written when the build finishes.'
            : 'No report for this build, so there is nothing to list. Build reports come from Unity.'}
        </p>
      </div>
    )
  }

  if (!assets) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 size={20} className="animate-spin text-accent" />
      </div>
    )
  }

  const total = assets.reduce((n, a) => n + a.bytes, 0)
  const biggest = byType[0]?.bytes ?? 1

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <div className="relative w-60">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search shipped assets…"
            className="input h-7 pl-8"
          />
        </div>
        <div className="flex rounded-md border border-line bg-bg-soft p-0.5">
          {(['size', 'path', 'type'] as SortKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className={`h-5 rounded px-2 text-sm capitalize transition-colors ${
                sort === k ? 'bg-bg-active text-fg' : 'text-fg-subtle hover:text-fg-muted'
              }`}
            >
              {k}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs tabular-nums text-fg-subtle">
          {shown.length.toLocaleString()} of {assets.length.toLocaleString()} · {bytes(total)}
        </span>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        {byType.length > 0 && (
          <section>
            <h3 className="section-label mb-1.5">Shipped by type</h3>
            <div className="space-y-1.5">
              {byType.slice(0, 10).map((t) => (
                <div key={t.type} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-xs text-fg-muted">{t.type}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-hover">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.max(1, (t.bytes / biggest) * 100)}%`,
                        backgroundColor: categoryColor(t.type)
                      }}
                    />
                  </span>
                  <span className="w-20 shrink-0 text-right text-xs tabular-nums text-fg-muted">
                    {bytes(t.bytes)}
                  </span>
                  <span className="w-14 shrink-0 text-right text-xs tabular-nums text-fg-faint">
                    {t.count.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <h3 className="section-label mb-1.5">Assets in the build</h3>
          <div className="overflow-hidden rounded-lg border border-line">
            {shown.slice(0, limit).map((a) => (
              <div
                key={a.path}
                className="flex items-center gap-3 border-b border-line px-2.5 py-1.5 text-xs last:border-0 hover:bg-bg-hover"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: categoryColor(a.type || 'Other') }}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-fg-muted" title={a.path}>
                  {a.path}
                </span>
                <span className="w-24 shrink-0 truncate text-right text-fg-faint">{a.type}</span>
                <span className="w-20 shrink-0 text-right tabular-nums text-fg">
                  {bytes(a.bytes)}
                </span>
              </div>
            ))}
            {shown.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-fg-subtle">
                Nothing matches that search.
              </div>
            )}
          </div>
          {limit < shown.length && (
            <button
              onClick={() => setLimit((n) => n + 500)}
              className="mt-2 w-full rounded-md border border-line bg-bg-soft py-1.5 text-xs text-fg-subtle hover:text-fg"
            >
              Show more ({(shown.length - limit).toLocaleString()} left)
            </button>
          )}
        </section>
      </div>
    </div>
  )
}
