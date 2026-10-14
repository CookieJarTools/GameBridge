import { useEffect } from 'react'
import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { LibraryView } from './components/LibraryView'
import { SettingsView } from './components/SettingsView'
import { AssetStoreView } from './components/AssetStoreView'
import { InstancesView } from './components/InstancesView'
import { DataView } from './components/DataView'
import { Toasts } from './components/Toasts'

export default function App(): JSX.Element {
  const load = useStore((s) => s.load)
  const loaded = useStore((s) => s.loaded)
  const view = useStore((s) => s.view)

  useEffect(() => {
    load()
  }, [load])

  // Subscribe to streamed build + run events for the whole app lifetime.
  useEffect(() => {
    const offBuildLog = window.gamebridge.onBuildLog((e) => useStore.getState().ingestBuildLog(e))
    const offBuildDone = window.gamebridge.onBuildDone((e) => {
      const st = useStore.getState()
      st.ingestBuildDone(e)
      const name = st.projects.find((p) => p.id === e.projectId)?.name ?? 'Project'
      const fallback = e.ok ? `Build succeeded: ${name}` : `Build failed: ${name}`
      st.toast(e.message ?? fallback, e.ok ? 'ok' : 'error')
    })
    const offBuildProgress = window.gamebridge.onBuildProgress((e) =>
      useStore.getState().ingestBuildProgress(e)
    )
    const offAssetProgress = window.gamebridge.onAssetScanProgress((e) =>
      useStore.getState().ingestAssetProgress(e)
    )
    const offNeedsForce = window.gamebridge.onBuildNeedsForce((e) =>
      useStore.getState().ingestNeedsForce(e)
    )
    const offPublishStarted = window.gamebridge.onPublishStarted((e) =>
      useStore.getState().ingestPublishStarted(e)
    )
    const offPublishLog = window.gamebridge.onPublishLog((e) =>
      useStore.getState().ingestPublishLog(e)
    )
    const offPublishDone = window.gamebridge.onPublishDone((e) =>
      useStore.getState().ingestPublishDone(e)
    )
    const offRunLog = window.gamebridge.onRunLog((e) => useStore.getState().ingestRunLog(e))
    const offRunExit = window.gamebridge.onRunExit((e) => {
      const st = useStore.getState()
      st.ingestRunExit(e)
      if (e.signal || (e.code != null && e.code !== 0)) {
        const name = st.projects.find((p) => p.id === e.projectId)?.name ?? 'Game'
        st.toast(`${name} crashed — see Console`, 'error')
      }
    })
    const st = useStore.getState()
    st.loadBuilds()
    st.syncRunningRuns()
    return () => {
      offBuildLog()
      offBuildDone()
      offBuildProgress()
      offAssetProgress()
      offNeedsForce()
      offPublishStarted()
      offPublishLog()
      offPublishDone()
      offRunLog()
      offRunExit()
    }
  }, [])

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        {!loaded ? (
          <div className="flex flex-1 items-center justify-center text-base text-fg-faint">Loading…</div>
        ) : view === 'library' ? (
          <LibraryView />
        ) : view === 'stores' ? (
          <AssetStoreView />
        ) : view === 'instances' ? (
          <InstancesView />
        ) : view === 'data' ? (
          <DataView />
        ) : (
          <SettingsView />
        )}
      </main>
      <Toasts />
    </div>
  )
}
