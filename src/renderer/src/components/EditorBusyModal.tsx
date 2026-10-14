import { AlertTriangle, Hammer, X } from 'lucide-react'
import { useStore } from '../store'

/**
 * Two prompts about an editor standing in the way of a build:
 * the consent one before we touch it, and the follow-up when it won't close.
 * Both are deliberately blunt about unsaved work.
 */
export function EditorBusyModal(): JSX.Element | null {
  const pending = useStore((s) => s.pendingBuild)
  const confirmCloseEditor = useStore((s) => s.confirmCloseEditor)
  const cancelPendingBuild = useStore((s) => s.cancelPendingBuild)
  const forcePrompt = useStore((s) => s.forcePrompt)
  const answerForcePrompt = useStore((s) => s.answerForcePrompt)

  if (forcePrompt) {
    return (
      <Shell
        title="The editor hasn't closed"
        onClose={() => answerForcePrompt('cancel')}
        tone="warn"
      >
        <p className="text-base text-fg-muted">
          <span className="text-fg">{forcePrompt.projectName}</span>&apos;s editor (pid{' '}
          {forcePrompt.pid}) is still running {forcePrompt.waited}s after being asked to close —
          either it is asking you to save, or it is busy importing.
        </p>
        <p className="mt-2 text-base leading-relaxed text-fg-subtle">
          Switch to it, let it finish or answer its prompt, and this build carries on by itself.
          Forcing it closed now kills the editor and{' '}
          <span className="text-warn">loses unsaved work</span>.
        </p>
        <div className="mt-4 flex items-center justify-end gap-1.5">
          <button onClick={() => answerForcePrompt('cancel')} className="btn-ghost">
            Cancel the build
          </button>
          <button
            onClick={() => answerForcePrompt('force')}
            className="btn-danger"
          >
            <AlertTriangle size={13} /> Force close
          </button>
        </div>
      </Shell>
    )
  }

  if (!pending) return null

  return (
    <Shell title="The editor has this project open" onClose={cancelPendingBuild} tone="accent">
      <p className="text-base text-fg-muted">
        <span className="text-fg">{pending.editor.projectName}</span> is open in an editor
        {pending.editor.version ? ` (${pending.editor.version})` : ''} as pid {pending.editor.pid}.
        The project can&apos;t be built while it&apos;s held open.
      </p>
      <p className="mt-2 text-base leading-relaxed text-fg-subtle">
        GameBridge will ask it to close normally, so it can prompt you about anything unsaved, run
        the build, then reopen the project for you. If it doesn&apos;t close within 30 seconds
        you&apos;ll be asked again.
      </p>
      <div className="mt-4 flex items-center justify-end gap-1.5">
        <button onClick={cancelPendingBuild} className="btn-ghost">
          Cancel
        </button>
        <button onClick={confirmCloseEditor} className="btn-primary">
          <Hammer size={13} /> Close editor and build
        </button>
      </div>
    </Shell>
  )
}

function Shell({
  title,
  tone,
  onClose,
  children
}: {
  title: string
  tone: 'accent' | 'warn'
  onClose: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="w-full max-w-[420px] rounded-lg border border-line bg-bg-panel shadow-popover">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <AlertTriangle size={14} className={tone === 'warn' ? 'text-warn' : 'text-accent'} />
          <h2 className="text-md font-medium tracking-tight text-fg">{title}</h2>
          <button onClick={onClose} className="btn-icon ml-auto">
            <X size={15} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}
