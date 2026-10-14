import { AlertTriangle, CheckCircle2, CircleDot, Loader2, XCircle } from 'lucide-react'
import type { BuildUi, RunUi } from '../store'

/** Status glyph for a build, shared by the list and the detail header. */
export function StatusIcon({ build, size = 13 }: { build: BuildUi; size?: number }): JSX.Element {
  if (build.running) return <Loader2 size={size} className="text-accent animate-spin" />
  if (build.phase === 'succeeded') return <CheckCircle2 size={size} className="text-ok" />
  if (build.phase === 'cancelled') return <AlertTriangle size={size} className="text-fg-subtle" />
  return <XCircle size={size} className="text-danger" />
}

/** Status glyph for a run: live, reconnectable, crashed or finished. */
export function RunIcon({ run, size = 13 }: { run: RunUi; size?: number }): JSX.Element {
  const color = run.running
    ? 'text-ok'
    : run.canReattach
      ? 'text-accent'
      : run.crashed
        ? 'text-danger'
        : 'text-fg-faint'
  return <CircleDot size={size} className={color + (run.running ? ' animate-pulse' : '')} />
}
