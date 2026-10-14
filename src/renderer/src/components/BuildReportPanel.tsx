import { useMemo, useState } from 'react'
import { AlertTriangle, FileText, XCircle } from 'lucide-react'
import type { BuildUi } from '../store'
import { bytes, categoryColor, duration } from '../lib/format'

/**
 * What Unity's BuildReport says about the finished build: size, where the time
 * went, and which assets took up the space.
 */
export function BuildReportPanel({ build }: { build: BuildUi }): JSX.Element {
  const report = build.report
  const [assetLimit, setAssetLimit] = useState(30)

  const byType = useMemo(() => {
    if (!report) return []
    const totals = new Map<string, { bytes: number; count: number }>()
    for (const a of report.assets) {
      const key = a.type || 'Other'
      const cur = totals.get(key) ?? { bytes: 0, count: 0 }
      cur.bytes += a.bytes
      cur.count++
      totals.set(key, cur)
    }
    return [...totals.entries()]
      .map(([type, v]) => ({ type, ...v }))
      .sort((a, b) => b.bytes - a.bytes)
  }, [report])

  const slowestSteps = useMemo(() => {
    if (!report) return []
    return [...report.steps].sort((a, b) => b.seconds - a.seconds).slice(0, 12)
  }, [report])

  if (!report) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <FileText size={30} className="mb-3 text-fg-faint" />
        <p className="max-w-md text-base text-fg-muted">
          {build.running
            ? 'The report is written when the build finishes.'
            : build.engineId === 'unity'
              ? 'No report for this build. Unity only writes one once it gets as far as building the player — check the log for what stopped it.'
              : 'Build reports come from Unity. Other engines only stream their build output.'}
        </p>
      </div>
    )
  }

  const assetTotal = report.assets.reduce((n, a) => n + a.bytes, 0)
  const biggest = byType[0]?.bytes ?? 1

  return (
    <div className="flex-1 space-y-5 overflow-y-auto p-4">
      {/* Headline numbers */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Build size', value: bytes(report.totalBytes) },
          { label: 'Build time', value: duration(report.totalSeconds) },
          { label: 'Errors', value: String(report.errors), bad: report.errors > 0 },
          { label: 'Warnings', value: String(report.warnings), warn: report.warnings > 0 }
        ].map((card) => (
          <div key={card.label} className="rounded-lg border border-line bg-bg-soft px-3 py-2.5">
            <div className="text-xs text-fg-subtle">{card.label}</div>
            <div
              className={`mt-0.5 text-xl font-semibold tabular-nums tracking-tight ${
                card.bad ? 'text-danger' : card.warn ? 'text-warn' : 'text-fg'
              }`}
            >
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {report.outputPath && (
        <div className="truncate font-mono text-xs text-fg-subtle" title={report.outputPath}>
          {report.outputPath}
        </div>
      )}

      {/* Build errors and warnings */}
      {report.messages.length > 0 && (
        <section>
          <h3 className="section-label mb-1.5">Messages</h3>
          <div className="space-y-1">
            {report.messages.slice(0, 12).map((m, i) => {
              const error = /error|exception|assert/i.test(m.type)
              return (
                <div
                  key={i}
                  className={`flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs ${
                    error
                      ? 'border-danger/25 bg-danger/[0.06] text-[#f7c9cb]'
                      : 'border-warn/25 bg-warn/[0.06] text-[#f6e6b4]'
                  }`}
                >
                  {error ? (
                    <XCircle size={12} className="mt-0.5 shrink-0 text-danger" />
                  ) : (
                    <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warn" />
                  )}
                  <span className="whitespace-pre-wrap break-words font-mono">{m.content}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Where the size went */}
      {byType.length > 0 && (
        <section>
          <h3 className="section-label mb-1.5">
            Size by asset type
            <span className="ml-1.5 normal-case tracking-normal text-fg-faint">
              {bytes(assetTotal)} of packed assets
            </span>
          </h3>
          <div className="space-y-1.5">
            {byType.slice(0, 10).map((t) => (
              <div key={t.type} className="flex items-center gap-3">
                <span className="w-28 shrink-0 truncate text-xs text-fg-muted" title={t.type}>
                  {t.type}
                </span>
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
                <span className="w-12 shrink-0 text-right text-xs tabular-nums text-fg-faint">
                  {t.count}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Slowest steps */}
      {slowestSteps.length > 0 && (
        <section>
          <h3 className="section-label mb-1.5">Where the time went</h3>
          <div className="overflow-hidden rounded-lg border border-line">
            {slowestSteps.map((step, i) => (
              <div
                key={i}
                className="flex items-center gap-3 border-b border-line px-2.5 py-1.5 text-xs last:border-0 hover:bg-bg-hover"
              >
                <span className="min-w-0 flex-1 truncate text-fg-muted" title={step.name}>
                  {step.name}
                </span>
                {step.errors > 0 && <span className="tabular-nums text-danger">{step.errors}e</span>}
                {step.warnings > 0 && (
                  <span className="tabular-nums text-warn">{step.warnings}w</span>
                )}
                <span className="w-16 text-right tabular-nums text-fg-subtle">
                  {duration(step.seconds)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Largest assets in the build */}
      {report.assets.length > 0 && (
        <section>
          <h3 className="section-label mb-1.5">
            Biggest assets in the build
            <span className="ml-1.5 normal-case tracking-normal text-fg-faint">
              {report.assets.length} tracked
            </span>
          </h3>
          <div className="overflow-hidden rounded-lg border border-line">
            {report.assets.slice(0, assetLimit).map((a) => (
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
          </div>
          {assetLimit < report.assets.length && (
            <button
              onClick={() => setAssetLimit((n) => n + 100)}
              className="mt-2 w-full rounded-md border border-line bg-bg-soft py-1.5 text-xs text-fg-subtle hover:text-fg"
            >
              Show more ({report.assets.length - assetLimit} left)
            </button>
          )}
        </section>
      )}
    </div>
  )
}
