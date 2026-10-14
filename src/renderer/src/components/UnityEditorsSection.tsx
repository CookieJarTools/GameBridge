import { useEffect, useState } from 'react'
import { RefreshCw, DownloadCloud, Loader2, Check, X, ChevronDown, ExternalLink } from 'lucide-react'
import type { UnityRelease } from '@shared/types'
import { useStore } from '../store'

interface InstallState {
  log: string[]
  running: boolean
  ok?: boolean
}

const MODULES = [
  { id: 'android', label: 'Android' },
  { id: 'webgl', label: 'WebGL' },
  { id: 'windows-il2cpp', label: 'Windows IL2CPP' },
  { id: 'linux-il2cpp', label: 'Linux IL2CPP' }
]

export function UnityEditorsSection(): JSX.Element {
  const installed = useStore((s) => s.settings?.engineConfig.unityEditors ?? [])
  const hubPath = useStore((s) => s.settings?.engineConfig.unityHubPath)
  const refreshData = useStore((s) => s.refreshData)
  const toast = useStore((s) => s.toast)

  const [releases, setReleases] = useState<UnityRelease[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [modules, setModules] = useState<string[]>([])
  const [installs, setInstalls] = useState<Record<string, InstallState>>({})
  const [expandedLog, setExpandedLog] = useState<string | null>(null)

  useEffect(() => {
    const offLog = window.gamebridge.onInstallLog((e) => {
      if (e.key === 'create-project') return
      setInstalls((cur) => {
        const s = cur[e.key] ?? { log: [], running: true }
        return { ...cur, [e.key]: { ...s, running: true, log: [...s.log, e.line].slice(-200) } }
      })
    })
    const offDone = window.gamebridge.onInstallDone(async (e) => {
      setInstalls((cur) => {
        const s = cur[e.key] ?? { log: [], running: false }
        return { ...cur, [e.key]: { ...s, running: false, ok: e.ok } }
      })
      toast(e.message, e.ok ? 'ok' : 'error')
      if (e.ok) await refreshData()
    })
    return () => {
      offLog()
      offDone()
    }
  }, [refreshData, toast])

  const refreshInstalled = async (): Promise<void> => {
    await window.gamebridge.unityRefreshInstalled()
    await refreshData()
    toast('Refreshed installed Unity editors.')
  }

  const loadReleases = async (): Promise<void> => {
    setLoading(true)
    try {
      setReleases(await window.gamebridge.unityReleases())
    } finally {
      setLoading(false)
    }
  }

  const install = async (version: string): Promise<void> => {
    setInstalls((cur) => ({ ...cur, [version]: { log: [], running: true } }))
    setExpandedLog(version)
    const res = await window.gamebridge.unityInstall(version, modules)
    if (!res.ok) {
      toast(res.message, 'error')
      setInstalls((cur) => ({ ...cur, [version]: { log: [res.message], running: false, ok: false } }))
    }
  }

  const installedVersions = new Set(installed.map((e) => e.version))

  if (!hubPath) {
    return (
      <p className="text-sm text-fg-muted">
        Unity Hub not found. Click <span className="text-fg">Auto-detect engines</span> above
        (or set the Hub path) to manage Unity editors.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {/* Installed */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-fg-muted">
            Installed editors ({installed.length})
          </span>
          <button onClick={refreshInstalled} className="btn-secondary !py-1 !px-2 text-xs">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {installed.map((ed) => (
            <div
              key={ed.version + ed.location}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-soft border border-line"
            >
              <span className="text-sm text-fg">{ed.version}</span>
              <span className="text-[10px] text-fg-faint truncate">{ed.location}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Install new */}
      <div className="pt-1">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-medium text-fg-muted">Install a version</span>
          <button
            onClick={loadReleases}
            disabled={loading}
            className="btn-secondary !py-1 !px-2 text-xs ml-auto"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <DownloadCloud size={13} />}
            {releases ? 'Reload list' : 'Browse versions'}
          </button>
        </div>

        {releases && (
          <>
            <div className="flex flex-wrap gap-3 mb-2">
              <span className="text-[11px] text-fg-subtle">Modules:</span>
              {MODULES.map((m) => (
                <label key={m.id} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={modules.includes(m.id)}
                    onChange={(e) =>
                      setModules((cur) =>
                        e.target.checked ? [...cur, m.id] : cur.filter((x) => x !== m.id)
                      )
                    }
                    className="h-3 w-3 accent-[#6d8bff]"
                  />
                  <span className="text-[11px] text-fg-muted">{m.label}</span>
                </label>
              ))}
            </div>
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {releases.map((r) => {
                const st = installs[r.version]
                const done = installedVersions.has(r.version)
                return (
                  <div key={r.version} className="rounded-lg bg-bg-soft border border-line">
                    <div className="flex items-center gap-2 px-3 py-2">
                      <span className="text-sm text-fg">{r.version}</span>
                      <div className="ml-auto flex items-center gap-2">
                        {st?.log.length ? (
                          <button
                            onClick={() => setExpandedLog(expandedLog === r.version ? null : r.version)}
                            className="text-[11px] text-fg-subtle hover:text-fg-muted flex items-center gap-0.5"
                          >
                            log <ChevronDown size={12} />
                          </button>
                        ) : null}
                        {done ? (
                          <span className="flex items-center gap-1 text-[11px] text-ok">
                            <Check size={13} /> installed
                          </span>
                        ) : st?.running ? (
                          <button
                            onClick={() => window.gamebridge.unityCancelInstall(r.version)}
                            className="flex items-center gap-1 text-[11px] text-fg-muted hover:text-danger"
                          >
                            <Loader2 size={12} className="animate-spin" /> installing — cancel
                          </button>
                        ) : (
                          <button
                            onClick={() => install(r.version)}
                            className="flex items-center gap-1 px-2 py-1 rounded-md bg-accent hover:bg-accent/90 text-white text-[11px] font-medium"
                          >
                            <DownloadCloud size={12} /> Install
                          </button>
                        )}
                      </div>
                    </div>
                    {expandedLog === r.version && st?.log.length ? (
                      <pre className="mx-3 mb-2 max-h-32 overflow-y-auto rounded bg-[#0a0b0e] border border-line p-2 text-[10px] font-mono text-fg-muted whitespace-pre-wrap break-all">
                        {st.log.join('\n')}
                      </pre>
                    ) : null}
                  </div>
                )
              })}
            </div>
            <p className="mt-2 text-[11px] text-fg-subtle">
              Installs download several GB and can take a while. The list shows Unity's promoted
              releases; older versions can be installed from the Unity Hub directly.
            </p>
          </>
        )}
      </div>

      {/* Unreal note */}
      <div className="pt-3 border-t border-line">
        <p className="text-xs text-fg-subtle flex items-center gap-2">
          <X size={13} className="text-fg-faint" />
          Unreal engine versions install through the Epic Games Launcher — no CLI is available.
          <button
            onClick={() => window.gamebridge.openExternal('com.epicgames.launcher://apps')}
            className="text-accent hover:underline flex items-center gap-0.5"
          >
            Open Epic <ExternalLink size={11} />
          </button>
        </p>
      </div>
    </div>
  )
}
