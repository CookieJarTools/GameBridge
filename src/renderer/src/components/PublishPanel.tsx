import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Rocket,
  Settings2,
  Square,
  Upload,
  XCircle
} from 'lucide-react'
import type { Project, PublishTarget } from '@shared/types'
import { useStore, type BuildUi } from '../store'
import { LogViewer } from './LogViewer'
import { PublishTargetsModal } from './PublishTargetsModal'

const KIND_LABEL: Record<PublishTarget['kind'], string> = {
  steam: 'Steam',
  itch: 'itch.io',
  custom: 'Custom command'
}

/**
 * Sending a finished build somewhere. Every upload is an explicit press with a
 * confirmation naming the target, the folder and the version — nothing here
 * happens on its own when a build finishes.
 */
export function PublishPanel({
  project,
  build
}: {
  project: Project
  build: BuildUi
}): JSX.Element {
  const upload = useStore((s) => s.upload)
  const startUpload = useStore((s) => s.startUpload)
  const cancelUpload = useStore((s) => s.cancelUpload)
  const dismissUpload = useStore((s) => s.dismissUpload)

  const [managing, setManaging] = useState(false)
  const [confirming, setConfirming] = useState<PublishTarget | null>(null)

  const targets = project.publishTargets ?? []
  const succeeded = build.phase === 'succeeded'
  const busy = !!upload?.running
  const folder = build.outputPath ?? build.report?.outputPath ?? ''

  // The live upload takes over the panel while it runs.
  if (upload && upload.buildId === build.id) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
          {upload.running ? (
            <Loader2 size={13} className="animate-spin text-accent" />
          ) : upload.ok ? (
            <CheckCircle2 size={13} className="text-ok" />
          ) : (
            <XCircle size={13} className="text-danger" />
          )}
          <span className="text-base font-medium text-fg">{upload.targetName}</span>
          <span className="chip">v{upload.version}</span>
          <span className="truncate text-sm text-fg-subtle">
            {upload.running ? 'Uploading…' : upload.message}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {upload.running ? (
              <button onClick={cancelUpload} className="btn-secondary hover:text-danger">
                <Square size={11} fill="currentColor" /> Stop
              </button>
            ) : (
              <button onClick={dismissUpload} className="btn-secondary">
                Back to targets
              </button>
            )}
          </div>
        </div>
        <LogViewer key={upload.id} lines={upload.lines} />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {!succeeded && (
          <div className="flex items-start gap-2 rounded-md border border-warn/25 bg-warn/6 px-2.5 py-2 text-xs leading-relaxed text-[#f6e6b4]">
            <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warn" />
            <span>Only a build that succeeded can be uploaded.</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <h3 className="section-label">Publish targets</h3>
          <span className="text-xs tabular-nums text-fg-faint">{targets.length}</span>
          <button onClick={() => setManaging(true)} className="btn-ghost ml-auto">
            <Settings2 size={13} /> Manage targets
          </button>
        </div>

        {targets.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-line bg-bg-soft px-6 py-10 text-center">
            <Rocket size={28} className="mb-3 text-fg-faint" />
            <h3 className="text-md font-medium text-fg">No publish targets yet</h3>
            <p className="mt-1 max-w-md text-base text-fg-muted">
              Add one for Steam or itch.io — or any command you already use — and finished builds
              can be sent there in a click.
            </p>
            <button onClick={() => setManaging(true)} className="btn-primary mt-4">
              <Settings2 size={13} /> Add a target
            </button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line">
            {targets.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-base font-medium text-fg">{t.name}</span>
                    <span className="chip">{KIND_LABEL[t.kind]}</span>
                    {t.dryRun && (
                      <span className="chip border-warn/30 bg-warn/10 text-warn">dry run</span>
                    )}
                  </div>
                  <div className="truncate font-mono text-2xs text-fg-faint">
                    {t.kind === 'steam'
                      ? `app ${t.appId ?? '?'} · depot ${t.depotId ?? '?'}${t.branch ? ` · ${t.branch}` : ''}`
                      : t.kind === 'itch'
                        ? (t.itchTarget ?? 'no destination set')
                        : (t.command ?? 'no command set')}
                  </div>
                </div>
                <button
                  onClick={() => setConfirming(t)}
                  disabled={!succeeded || busy || !folder}
                  className="btn-primary shrink-0"
                >
                  <Upload size={13} /> Upload
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs leading-relaxed text-fg-faint">
          GameBridge never stores a password or API key. steamcmd and butler each keep their own
          cached login — run <span className="font-mono text-fg-subtle">steamcmd +login you</span>{' '}
          or <span className="font-mono text-fg-subtle">butler login</span> once in a terminal and
          uploads from here work unattended.
        </p>
      </div>

      {managing && (
        <PublishTargetsModal project={project} onClose={() => setManaging(false)} />
      )}

      {confirming && (
        <ConfirmUpload
          target={confirming}
          folder={folder}
          version={build.version ?? 'unknown'}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const target = confirming
            setConfirming(null)
            startUpload(build.id, target.id)
          }}
        />
      )}
    </div>
  )
}

function ConfirmUpload({
  target,
  folder,
  version,
  onCancel,
  onConfirm
}: {
  target: PublishTarget
  folder: string
  version: string
  onCancel: () => void
  onConfirm: () => void
}): JSX.Element {
  const destination =
    target.kind === 'steam'
      ? `Steam app ${target.appId}, depot ${target.depotId}${target.branch ? `, setting branch "${target.branch}" live` : ''}`
      : target.kind === 'itch'
        ? `itch.io ${target.itchTarget}`
        : target.command ?? ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="w-full max-w-[460px] rounded-lg border border-line bg-bg-panel shadow-popover">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Upload size={14} className="text-accent" />
          <h2 className="text-md font-medium tracking-tight text-fg">Upload to {target.name}</h2>
        </div>
        <div className="space-y-2.5 p-4">
          <Field label="Sending">
            <span className="font-mono text-xs">{folder}</span>
          </Field>
          <Field label="As version">
            <span className="tabular-nums">{version}</span>
          </Field>
          <Field label="To">
            <span className="font-mono text-xs">{destination}</span>
          </Field>
          {target.dryRun ? (
            <p className="text-base leading-relaxed text-fg-subtle">
              This target is set to a dry run, so the tool will check the upload without publishing
              it.
            </p>
          ) : (
            <p className="text-base leading-relaxed text-warn">
              This publishes to a live service and other people may be able to download it.
            </p>
          )}
          <div className="mt-4 flex items-center justify-end gap-1.5">
            <button onClick={onCancel} className="btn-ghost">
              Cancel
            </button>
            <button onClick={onConfirm} className="btn-primary">
              <Upload size={13} /> Upload
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <span className="w-20 shrink-0 text-sm text-fg-subtle">{label}</span>
      <span className="min-w-0 flex-1 break-all text-base text-fg">{children}</span>
    </div>
  )
}
