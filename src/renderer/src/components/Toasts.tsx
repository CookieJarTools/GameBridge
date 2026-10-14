import { CheckCircle2, AlertTriangle, X } from 'lucide-react'
import { useStore } from '../store'

export function Toasts(): JSX.Element {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex w-[320px] flex-col gap-1.5">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-start gap-2 rounded-lg border border-line bg-bg-panel px-3 py-2.5 shadow-popover"
        >
          {t.kind === 'error' ? (
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
          ) : (
            <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ok" />
          )}
          <span className="flex-1 text-base leading-snug text-fg">{t.text}</span>
          <button onClick={() => dismiss(t.id)} className="shrink-0 text-fg-faint hover:text-fg">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
